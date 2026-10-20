use serde::Serialize;

/// Arayüzün hatayı türüne göre ele alabilmesi için sınıf; metin `message`'da.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorKind {
    /// TCP/DNS/bağlantı kopması
    Connection,
    /// Parola / ACL reddi (WRONGPASS, NOAUTH, NOPERM)
    Auth,
    Timeout,
    /// Sunucunun döndürdüğü komut hatası (ERR, WRONGTYPE …)
    Redis,
    /// Salt okunur bağlantıda yazma denemesi
    ReadOnly,
    NotFound,
    /// Hedef anahtar zaten var
    Exists,
    /// Geçersiz girdi (desen, regex, port …)
    Invalid,
    Io,
    Ssh,
    Tls,
    Cancelled,
    Internal,
}

#[derive(Debug, Clone, Serialize, thiserror::Error)]
#[serde(rename_all = "camelCase")]
#[error("{message}")]
pub struct AppError {
    pub kind: ErrorKind,
    pub message: String,
}

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        AppError { kind, message: message.into() }
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Invalid, message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::NotFound, message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Internal, message)
    }

    pub fn cancelled() -> Self {
        Self::new(ErrorKind::Cancelled, "cancelled")
    }

    pub fn read_only() -> Self {
        Self::new(ErrorKind::ReadOnly, "connection is read-only")
    }

    pub fn exists(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Exists, message)
    }

    pub fn connection(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Connection, message)
    }
}

impl From<redis::RedisError> for AppError {
    fn from(err: redis::RedisError) -> Self {
        let code = err.code().unwrap_or_default();
        let kind = if matches!(code, "NOAUTH" | "WRONGPASS" | "NOPERM") || err.kind() == redis::ErrorKind::AuthenticationFailed {
            ErrorKind::Auth
        } else if err.is_timeout() {
            ErrorKind::Timeout
        } else if err.is_io_error() || err.is_connection_dropped() || err.is_connection_refusal() {
            ErrorKind::Connection
        } else {
            ErrorKind::Redis
        };
        // Sunucu hatası redis-cli gibi görünsün: "WRONGTYPE Operation against …"
        let message = match (err.kind(), err.code(), err.detail()) {
            (redis::ErrorKind::Server(_) | redis::ErrorKind::Extension, Some(code), Some(detail)) => format!("{code} {detail}"),
            _ => err.to_string(),
        };
        AppError::new(kind, message)
    }
}

impl From<redis::ServerError> for AppError {
    fn from(err: redis::ServerError) -> Self {
        redis::RedisError::from(err).into()
    }
}

impl From<redis::ParsingError> for AppError {
    fn from(err: redis::ParsingError) -> Self {
        AppError::new(ErrorKind::Redis, format!("unexpected reply: {err}"))
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        let kind = match err.kind() {
            std::io::ErrorKind::TimedOut => ErrorKind::Timeout,
            std::io::ErrorKind::ConnectionRefused
            | std::io::ErrorKind::ConnectionReset
            | std::io::ErrorKind::ConnectionAborted
            | std::io::ErrorKind::NotConnected
            | std::io::ErrorKind::AddrNotAvailable => ErrorKind::Connection,
            std::io::ErrorKind::NotFound => ErrorKind::NotFound,
            _ => ErrorKind::Io,
        };
        AppError::new(kind, err.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        AppError::invalid(err.to_string())
    }
}
