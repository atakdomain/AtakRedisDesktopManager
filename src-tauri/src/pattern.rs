//! KeyFilter derleyicisi: sunucu glob deseni (SCAN/HSCAN/SSCAN/ZSCAN MATCH) + gerekiyorsa istemci doğrulayıcısı.
//! SAHİBİ: backend-ops ajanı — imzalar sözleşmedir, gövdeler iskelettir.

use crate::error::AppResult;
use crate::model::KeyFilter;

pub struct CompiledFilter {}

impl CompiledFilter {
    pub fn compile(_filter: &KeyFilter) -> AppResult<CompiledFilter> {
        unimplemented!()
    }

    /// MATCH argümanı. `is_match_all()` ise MATCH hiç gönderilmez.
    pub fn server_pattern(&self) -> &str {
        unimplemented!()
    }

    pub fn is_match_all(&self) -> bool {
        unimplemented!()
    }

    /// Sunucu deseninden geçen öğenin gerçekten eşleşip eşleşmediği.
    /// İstemci doğrulaması gerekmeyen filtrelerde her zaman true.
    pub fn matches(&self, _item: &[u8]) -> bool {
        unimplemented!()
    }

    /// exact + büyük/küçük harf duyarlı → doğrudan anahtar (EXISTS kısayolu)
    pub fn exact_key(&self) -> Option<&[u8]> {
        unimplemented!()
    }
}
