//! TCP / TLS / SSH akışları: hedef host:port'a TCP ya da SSH `direct-tcpip` kanalı, istenirse üstüne TLS.

mod ssh;
mod tls;

use crate::error::{AppError, AppResult, ErrorKind};
use crate::model::ConnectionConfig;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncWrite};

pub trait Stream: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> Stream for T {}

pub type BoxStream = Box<dyn Stream>;

/// Bir bağlantının tüm düğüm akışlarını üretir; SSH oturumu paylaşılır.
pub struct Connector {
    timeout: Duration,
    ssh: Option<ssh::SshTunnel>,
    tls: Option<tls::Tls>,
}

impl Connector {
    pub async fn new(config: &ConnectionConfig) -> AppResult<Connector> {
        let tls = if config.tls.enabled { Some(tls::Tls::new(&config.tls)?) } else { None };
        let ssh = if config.ssh.enabled { Some(ssh::SshTunnel::connect(&config.ssh).await?) } else { None };
        Ok(Connector { timeout: connect_timeout(config.timeout_sec), ssh, tls })
    }

    pub fn timeout(&self) -> Duration {
        self.timeout
    }

    pub async fn connect(&self, host: &str, port: u16) -> AppResult<BoxStream> {
        let stream = match &self.ssh {
            Some(ssh) => ssh.open(host, port).await?,
            None => self.tcp(host, port).await?,
        };
        match &self.tls {
            Some(tls) => tokio::time::timeout(self.timeout, tls.wrap(stream, host))
                .await
                .map_err(|_| AppError::new(ErrorKind::Timeout, format!("TLS handshake with {host}:{port} timed out")))?,
            None => Ok(stream),
        }
    }

    async fn tcp(&self, host: &str, port: u16) -> AppResult<BoxStream> {
        let stream = tokio::time::timeout(self.timeout, tokio::net::TcpStream::connect((host, port)))
            .await
            .map_err(|_| AppError::new(ErrorKind::Timeout, format!("connection to {host}:{port} timed out")))?
            .map_err(|err| AppError::connection(format!("cannot connect to {host}:{port}: {err}")))?;
        let _ = stream.set_nodelay(true);
        Ok(Box::new(stream))
    }

    pub async fn close(&self) {
        if let Some(ssh) = &self.ssh {
            ssh.close().await;
        }
    }
}

pub fn connect_timeout(timeout_sec: u32) -> Duration {
    Duration::from_secs(u64::from(if timeout_sec == 0 { 10 } else { timeout_sec }))
}
