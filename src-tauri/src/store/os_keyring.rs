//! İşletim sistemi anahtar zinciri: servis `AtakRedisDesktopManager`, hesap `<id>:<alan>`.
//! Tüm çağrılar bloklayıcıdır.

use keyring::{Entry, Error};

const SERVICE: &str = "AtakRedisDesktopManager";

pub struct Keyring;

impl Keyring {
    /// Anahtar zinciri kullanılamıyorsa (ör. Secret Service'siz Linux) `None`
    pub fn probe() -> Option<Keyring> {
        let entry = Entry::new(SERVICE, "probe").ok()?;
        match entry.get_password() {
            Ok(_) | Err(Error::NoEntry) => Some(Keyring),
            Err(err) => {
                eprintln!("OS keyring unavailable, secrets stay in connections.json: {err}");
                None
            }
        }
    }

    pub fn get(&self, id: &str, field: &str) -> Option<String> {
        entry(id, field)?.get_password().ok()
    }

    /// Başarısızsa false; çağıran gizli değeri dosyada tutar
    pub fn set(&self, id: &str, field: &str, value: &str) -> bool {
        entry(id, field).is_some_and(|e| e.set_password(value).is_ok())
    }

    pub fn delete(&self, id: &str, field: &str) {
        if let Some(e) = entry(id, field) {
            let _ = e.delete_credential();
        }
    }
}

fn entry(id: &str, field: &str) -> Option<Entry> {
    Entry::new(SERVICE, &format!("{id}:{field}")).ok()
}
