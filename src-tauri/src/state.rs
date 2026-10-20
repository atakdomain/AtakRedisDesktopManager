use crate::session::SessionManager;
use crate::store::Store;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tokio_util::sync::CancellationToken;

pub struct AppState {
    pub store: Store,
    pub sessions: SessionManager,
    /// Taramalar, toplu işler ve abonelikler; kimliği arayüz üretir
    pub tasks: TaskRegistry,
}

/// Çalışan görevin iptal belirteci; `finish` yalnızca kendi kaydını siler.
pub struct TaskHandle {
    pub token: CancellationToken,
    generation: u64,
}

#[derive(Default)]
pub struct TaskRegistry {
    inner: Mutex<HashMap<String, (u64, CancellationToken)>>,
    next: AtomicU64,
}

impl TaskRegistry {
    /// Aynı kimlikle çalışan bir görev varsa önce onu iptal eder.
    pub fn register(&self, id: &str) -> TaskHandle {
        let generation = self.next.fetch_add(1, Ordering::Relaxed);
        let token = CancellationToken::new();
        if let Some((_, old)) = self.inner.lock().unwrap().insert(id.to_string(), (generation, token.clone())) {
            old.cancel();
        }
        TaskHandle { token, generation }
    }

    pub fn cancel(&self, id: &str) {
        if let Some((_, token)) = self.inner.lock().unwrap().remove(id) {
            token.cancel();
        }
    }

    pub fn finish(&self, id: &str, handle: &TaskHandle) {
        let mut map = self.inner.lock().unwrap();
        if map.get(id).is_some_and(|(generation, _)| *generation == handle.generation) {
            map.remove(id);
        }
    }
}
