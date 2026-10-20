//! Tek SSH oturumu üzerinden `direct-tcpip` kanalları (yerel port dinleyicisi yok).

use super::BoxStream;
use crate::error::{AppError, AppResult, ErrorKind};
use crate::model::{SshAuth, SshConfig};
use russh::client::{self, AuthResult, Handle};
use russh::keys::agent::client::{AgentClient, AgentStream};
use russh::keys::{PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;

pub struct SshTunnel {
    config: SshConfig,
    handle: Mutex<Option<Arc<Handle<AcceptAnyHost>>>>,
}

/// ARDM gibi sunucu anahtarı sorgulanmadan kabul edilir
pub struct AcceptAnyHost;

impl client::Handler for AcceptAnyHost {
    type Error = russh::Error;

    async fn check_server_key(&mut self, _key: &PublicKeyOrCertificate) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

fn ssh_error(context: &str, err: impl std::fmt::Display) -> AppError {
    AppError::new(ErrorKind::Ssh, format!("SSH {context}: {err}"))
}

impl SshTunnel {
    /// Oturumu hemen kurar ki kimlik doğrulama hatası bağlanırken görünsün
    pub async fn connect(config: &SshConfig) -> AppResult<SshTunnel> {
        let tunnel = SshTunnel { config: config.clone(), handle: Mutex::new(None) };
        tunnel.session().await?;
        Ok(tunnel)
    }

    fn timeout(&self) -> Duration {
        Duration::from_secs(u64::from(self.config.timeout_sec.max(1)))
    }

    /// Kopmuşsa yeniden kurar
    async fn session(&self) -> AppResult<Arc<Handle<AcceptAnyHost>>> {
        let mut slot = self.handle.lock().await;
        if let Some(handle) = slot.as_ref().filter(|h| !h.is_closed()) {
            return Ok(handle.clone());
        }
        let handle = tokio::time::timeout(self.timeout(), self.establish())
            .await
            .map_err(|_| AppError::new(ErrorKind::Timeout, format!("SSH connection to {}:{} timed out", self.config.host, self.config.port)))??;
        let handle = Arc::new(handle);
        *slot = Some(handle.clone());
        Ok(handle)
    }

    async fn establish(&self) -> AppResult<Handle<AcceptAnyHost>> {
        let cfg = &self.config;
        let tcp = tokio::net::TcpStream::connect((cfg.host.as_str(), cfg.port))
            .await
            .map_err(|err| ssh_error(&format!("connection to {}:{}", cfg.host, cfg.port), err))?;
        let _ = tcp.set_nodelay(true);
        let config = Arc::new(client::Config {
            keepalive_interval: Some(Duration::from_secs(30)),
            nodelay: true,
            ..Default::default()
        });
        let mut handle = client::connect_stream(config, tcp, AcceptAnyHost).await.map_err(|err| ssh_error("handshake", err))?;
        let result = match cfg.auth {
            SshAuth::Password => handle.authenticate_password(&cfg.username, &cfg.password).await.map_err(|err| ssh_error("auth", err))?,
            SshAuth::PrivateKey => self.auth_key(&mut handle).await?,
            SshAuth::Agent => auth_agent(&mut handle, &cfg.username).await?,
        };
        if !result.success() {
            return Err(AppError::new(ErrorKind::Ssh, format!("SSH authentication failed for user {}", cfg.username)));
        }
        Ok(handle)
    }

    async fn auth_key(&self, handle: &mut Handle<AcceptAnyHost>) -> AppResult<AuthResult> {
        let cfg = &self.config;
        if cfg.private_key_path.is_empty() {
            return Err(AppError::new(ErrorKind::Ssh, "SSH private key file is not set"));
        }
        let passphrase = Some(cfg.passphrase.as_str()).filter(|p| !p.is_empty());
        let key = russh::keys::load_secret_key(&cfg.private_key_path, passphrase)
            .map_err(|err| ssh_error(&format!("private key {}", cfg.private_key_path), err))?;
        let hash = if key.algorithm().is_rsa() {
            handle.best_supported_rsa_hash().await.map_err(|err| ssh_error("auth", err))?.flatten()
        } else {
            None
        };
        let key = PrivateKeyWithHashAlg::new(Arc::new(key), hash);
        handle.authenticate_publickey(&cfg.username, key).await.map_err(|err| ssh_error("auth", err))
    }

    pub async fn open(&self, host: &str, port: u16) -> AppResult<BoxStream> {
        let open = async {
            let handle = self.session().await?;
            handle
                .channel_open_direct_tcpip(host, u32::from(port), "127.0.0.1", 0)
                .await
                .map_err(|err| ssh_error(&format!("tunnel to {host}:{port}"), err))
        };
        let channel = tokio::time::timeout(self.timeout(), open)
            .await
            .map_err(|_| AppError::new(ErrorKind::Timeout, format!("SSH tunnel to {host}:{port} timed out")))??;
        Ok(Box::new(channel.into_stream()))
    }

    pub async fn close(&self) {
        if let Some(handle) = self.handle.lock().await.take() {
            let _ = handle.disconnect(russh::Disconnect::ByApplication, "", "en").await;
        }
    }
}

async fn auth_agent(handle: &mut Handle<AcceptAnyHost>, user: &str) -> AppResult<AuthResult> {
    let mut agent = connect_agent().await?;
    let identities = agent.request_identities().await.map_err(|err| ssh_error("agent", err))?;
    let mut last = None;
    for identity in identities {
        let key = identity.public_key().into_owned();
        let hash = if key.algorithm().is_rsa() {
            handle.best_supported_rsa_hash().await.map_err(|err| ssh_error("auth", err))?.flatten()
        } else {
            None
        };
        let result = handle.authenticate_publickey_with(user, key, hash, &mut agent).await.map_err(|err| ssh_error("agent auth", err))?;
        if result.success() {
            return Ok(result);
        }
        last = Some(result);
    }
    last.ok_or_else(|| AppError::new(ErrorKind::Ssh, "SSH agent has no identities"))
}

type DynAgent = AgentClient<Box<dyn AgentStream + Send + Unpin + 'static>>;

#[cfg(unix)]
async fn connect_agent() -> AppResult<DynAgent> {
    let agent = AgentClient::connect_env().await.map_err(|err| ssh_error("agent (SSH_AUTH_SOCK)", err))?;
    Ok(agent.dynamic())
}

#[cfg(windows)]
async fn connect_agent() -> AppResult<DynAgent> {
    match AgentClient::connect_named_pipe(r"\\.\pipe\openssh-ssh-agent").await {
        Ok(agent) => Ok(agent.dynamic()),
        Err(pipe_err) => match AgentClient::connect_pageant().await {
            Ok(agent) => Ok(agent.dynamic()),
            Err(_) => Err(ssh_error("agent (OpenSSH agent pipe / Pageant)", pipe_err)),
        },
    }
}

#[cfg(not(any(unix, windows)))]
async fn connect_agent() -> AppResult<DynAgent> {
    Err(AppError::new(ErrorKind::Ssh, "SSH agent is not supported on this platform"))
}
