//! tokio-rustls (ring) ile TLS sarmalama.

use super::BoxStream;
use crate::error::{AppError, AppResult, ErrorKind};
use crate::model::TlsConfig;
use std::sync::Arc;
use tokio_rustls::rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use tokio_rustls::rustls::crypto::{self, CryptoProvider};
use tokio_rustls::rustls::pki_types::{CertificateDer, PrivateKeyDer, ServerName, UnixTime};
use tokio_rustls::rustls::{ClientConfig, DigitallySignedStruct, RootCertStore, SignatureScheme};
use tokio_rustls::TlsConnector;

pub struct Tls {
    connector: TlsConnector,
    server_name: String,
}

impl Tls {
    pub fn new(cfg: &TlsConfig) -> AppResult<Tls> {
        let provider = Arc::new(crypto::ring::default_provider());
        let builder = ClientConfig::builder_with_provider(provider.clone())
            .with_safe_default_protocol_versions()
            .map_err(tls_error)?;
        let builder = if cfg.skip_verify {
            builder.dangerous().with_custom_certificate_verifier(Arc::new(NoVerify(provider)))
        } else {
            builder.with_root_certificates(roots(&cfg.ca_path)?)
        };
        let config = if cfg.cert_path.is_empty() {
            builder.with_no_client_auth()
        } else {
            let key_path = if cfg.key_path.is_empty() { &cfg.cert_path } else { &cfg.key_path };
            builder.with_client_auth_cert(read_certs(&cfg.cert_path)?, read_key(key_path)?).map_err(tls_error)?
        };
        Ok(Tls { connector: TlsConnector::from(Arc::new(config)), server_name: cfg.server_name.clone() })
    }

    /// SNI: `serverName` doluysa o, değilse hedef host
    pub async fn wrap(&self, stream: BoxStream, host: &str) -> AppResult<BoxStream> {
        let name = if self.server_name.is_empty() { host } else { &self.server_name };
        let name = ServerName::try_from(name.to_string()).map_err(|_| AppError::new(ErrorKind::Tls, format!("invalid TLS server name: {name}")))?;
        let stream = self.connector.connect(name, stream).await.map_err(|err| AppError::new(ErrorKind::Tls, format!("TLS handshake failed: {err}")))?;
        Ok(Box::new(stream))
    }
}

fn tls_error(err: impl std::fmt::Display) -> AppError {
    AppError::new(ErrorKind::Tls, format!("TLS: {err}"))
}

fn roots(ca_path: &str) -> AppResult<RootCertStore> {
    let mut roots = RootCertStore::empty();
    if ca_path.is_empty() {
        for cert in rustls_native_certs::load_native_certs().certs {
            let _ = roots.add(cert);
        }
        if roots.is_empty() {
            return Err(AppError::new(ErrorKind::Tls, "no system root certificates found; set a CA file"));
        }
    } else {
        for cert in read_certs(ca_path)? {
            roots.add(cert).map_err(tls_error)?;
        }
    }
    Ok(roots)
}

fn open_pem(path: &str) -> AppResult<std::io::BufReader<std::fs::File>> {
    let file = std::fs::File::open(path).map_err(|err| AppError::new(ErrorKind::Tls, format!("cannot read {path}: {err}")))?;
    Ok(std::io::BufReader::new(file))
}

fn read_certs(path: &str) -> AppResult<Vec<CertificateDer<'static>>> {
    let certs = rustls_pemfile::certs(&mut open_pem(path)?)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| AppError::new(ErrorKind::Tls, format!("invalid certificate file {path}: {err}")))?;
    if certs.is_empty() {
        return Err(AppError::new(ErrorKind::Tls, format!("no certificate in {path}")));
    }
    Ok(certs)
}

fn read_key(path: &str) -> AppResult<PrivateKeyDer<'static>> {
    rustls_pemfile::private_key(&mut open_pem(path)?)
        .map_err(|err| AppError::new(ErrorKind::Tls, format!("invalid key file {path}: {err}")))?
        .ok_or_else(|| AppError::new(ErrorKind::Tls, format!("no private key in {path}")))
}

/// `skipVerify`: sertifika zinciri ve ad doğrulanmaz, el sıkışma imzası yine doğrulanır.
#[derive(Debug)]
struct NoVerify(Arc<CryptoProvider>);

impl ServerCertVerifier for NoVerify {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, tokio_rustls::rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, tokio_rustls::rustls::Error> {
        crypto::verify_tls12_signature(message, cert, dss, &self.0.signature_verification_algorithms)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, tokio_rustls::rustls::Error> {
        crypto::verify_tls13_signature(message, cert, dss, &self.0.signature_verification_algorithms)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.0.signature_verification_algorithms.supported_schemes()
    }
}
