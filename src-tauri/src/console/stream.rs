//! Adanmış bağlantılarda Pub/Sub aboneliği ve MONITOR; iptal belirteci gelene dek akar.

use crate::bytes::RBytes;
use crate::error::{AppError, AppResult, ErrorKind};
use crate::model::PubSubMessage;
use crate::session::{NodeAddr, Session};
use futures_util::StreamExt;
use redis::cmd;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio_util::sync::CancellationToken;

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

fn node_or_default(session: &Session, node: &str) -> AppResult<NodeAddr> {
    if node.is_empty() {
        Ok(session.default_node())
    } else {
        NodeAddr::parse(node)
    }
}

/// `emit` false dönerse (arayüz kanalı kapandı) abonelik biter
pub async fn subscribe(
    session: &Session,
    channels: &[String],
    patterns: &[String],
    cancel: CancellationToken,
    mut emit: impl FnMut(PubSubMessage) -> bool,
) -> AppResult<()> {
    if channels.is_empty() && patterns.is_empty() {
        return Err(AppError::invalid("no channel or pattern to subscribe"));
    }
    let stream = session.open_stream(&session.default_node()).await?;
    let mut pubsub = tokio::time::timeout(session.connect_timeout(), redis::aio::PubSub::new(&session.credentials(0), stream))
        .await
        .map_err(|_| AppError::new(ErrorKind::Timeout, "no response while setting up the subscription"))??;
    if !channels.is_empty() {
        pubsub.subscribe(channels).await?;
    }
    if !patterns.is_empty() {
        pubsub.psubscribe(patterns).await?;
    }
    let mut messages = pubsub.on_message();
    loop {
        tokio::select! {
            _ = cancel.cancelled() => return Ok(()),
            message = messages.next() => {
                let Some(message) = message else {
                    return Err(AppError::connection("subscription connection closed"));
                };
                let channel: Vec<u8> = message.get_channel().unwrap_or_default();
                let pattern: Option<String> = message.get_pattern().unwrap_or_default();
                let delivered = emit(PubSubMessage {
                    channel: RBytes(channel),
                    pattern: pattern.unwrap_or_default(),
                    payload: RBytes::from(message.get_payload_bytes()),
                    at_ms: now_ms(),
                });
                if !delivered {
                    return Ok(());
                }
            }
        }
    }
}

/// MONITOR çıktısını satır satır (`+` öneki olmadan) iletir
pub async fn monitor(session: &Session, node: &str, cancel: CancellationToken, mut emit: impl FnMut(String) -> bool) -> AppResult<()> {
    let node = node_or_default(session, node)?;
    let mut stream = BufReader::new(session.open_stream(&node).await?);
    let setup = async {
        let credentials = session.credentials(0);
        if let Some(password) = credentials.password() {
            let mut auth = cmd("AUTH");
            if let Some(username) = credentials.username() {
                auth.arg(username);
            }
            auth.arg(password);
            stream.write_all(&auth.get_packed_command()).await?;
            expect_ok(&mut stream).await?;
        }
        stream.write_all(&cmd("MONITOR").get_packed_command()).await?;
        expect_ok(&mut stream).await
    };
    tokio::time::timeout(session.connect_timeout(), setup)
        .await
        .map_err(|_| AppError::new(ErrorKind::Timeout, format!("{node}: no response to MONITOR")))??;

    let mut line = Vec::new();
    loop {
        line.clear();
        tokio::select! {
            _ = cancel.cancelled() => return Ok(()),
            read = stream.read_until(b'\n', &mut line) => {
                if read? == 0 {
                    return Err(AppError::connection("monitor connection closed"));
                }
                let text = String::from_utf8_lossy(line.trim_ascii_end());
                if let Some(error) = text.strip_prefix('-') {
                    return Err(AppError::new(ErrorKind::Redis, error));
                }
                if !emit(text.strip_prefix('+').unwrap_or(&text).to_string()) {
                    return Ok(());
                }
            }
        }
    }
}

async fn expect_ok(stream: &mut BufReader<crate::net::BoxStream>) -> AppResult<()> {
    let mut line = Vec::new();
    if stream.read_until(b'\n', &mut line).await? == 0 {
        return Err(AppError::connection("connection closed"));
    }
    let text = String::from_utf8_lossy(line.trim_ascii_end());
    match text.strip_prefix('-') {
        None => Ok(()),
        Some(error) if ["WRONGPASS", "NOAUTH", "NOPERM"].iter().any(|code| error.starts_with(code)) => Err(AppError::new(ErrorKind::Auth, error)),
        Some(error) if error.contains("invalid password") || error.contains("invalid username-password") => {
            Err(AppError::new(ErrorKind::Auth, error))
        }
        Some(error) => Err(AppError::new(ErrorKind::Redis, error)),
    }
}
