//! KeyFilter derleyicisi: sunucu glob deseni (SCAN/HSCAN/SSCAN/ZSCAN MATCH) + gerekiyorsa istemci doğrulayıcısı.
//!
//! Büyük/küçük harf duyarlıyken sunucu deseni kesindir (bayt anlamı). Duyarsızken eşleşme katlanmış karakterler
//! üzerindedir (`fold`: Unicode küçük harf, Türkçe İ/I/ı → i; `?` bir karakter); sunucu deseni bunun üst kümesidir:
//! ASCII harf `[aA]`, bayt bayt ifade edilemeyen her şey (i/I, ASCII dışı harf, `?`, olumsuz sınıf) `?*`.

use crate::error::{AppError, AppResult};
use crate::model::{KeyFilter, SearchMode};
use regex::bytes::{Regex, RegexBuilder};
use std::borrow::Cow;

pub struct CompiledFilter {
    server: String,
    exact: Option<Vec<u8>>,
    matcher: Matcher,
}

enum Matcher {
    All,
    /// Sunucu deseni kesin; istemcide aynı glob bayt bayt
    Glob,
    Folded(Vec<Tok>),
    Regex { re: Regex, fold: bool },
}

#[derive(Debug, PartialEq)]
enum Tok {
    Star,
    One,
    /// Duyarsız eşleşmede katlanmış hâli tutulur
    Lit(char),
    Class { neg: bool, items: Vec<ClassItem> },
}

#[derive(Debug, PartialEq)]
enum ClassItem {
    Ch(char),
    Range(char, char),
}

impl CompiledFilter {
    pub fn compile(filter: &KeyFilter) -> AppResult<CompiledFilter> {
        let term = filter.term.as_str();
        if term.is_empty() {
            return Ok(Self::all());
        }
        if filter.mode == SearchMode::Regex {
            return compile_regex(term, filter.case_sensitive);
        }
        if filter.mode == SearchMode::Glob && filter.case_sensitive {
            return Ok(Self::glob(term.to_string(), None));
        }
        let mut toks = match filter.mode {
            SearchMode::Glob => parse_glob(term),
            SearchMode::Exact => term.chars().map(Tok::Lit).collect(),
            _ => parse_term(term),
        };
        if filter.mode == SearchMode::Contains {
            toks.insert(0, Tok::Star);
        }
        if matches!(filter.mode, SearchMode::Contains | SearchMode::Prefix) {
            toks.push(Tok::Star);
        }
        if filter.case_sensitive {
            let exact = (filter.mode == SearchMode::Exact).then(|| term.as_bytes().to_vec());
            return Ok(Self::glob(emit_exact(&toks), exact));
        }
        if toks.iter().all(|t| *t == Tok::Star) {
            return Ok(Self::all());
        }
        let server = emit_folded(&toks);
        Ok(CompiledFilter { server, exact: None, matcher: Matcher::Folded(fold_toks(toks)) })
    }

    fn all() -> CompiledFilter {
        CompiledFilter { server: "*".into(), exact: None, matcher: Matcher::All }
    }

    fn glob(server: String, exact: Option<Vec<u8>>) -> CompiledFilter {
        let matcher = if server == "*" { Matcher::All } else { Matcher::Glob };
        CompiledFilter { server, exact, matcher }
    }

    /// MATCH argümanı. `is_match_all()` ise MATCH hiç gönderilmez; regex'te "*" (ya da sabit önek + "*").
    pub fn server_pattern(&self) -> &str {
        &self.server
    }

    pub fn is_match_all(&self) -> bool {
        matches!(self.matcher, Matcher::All)
    }

    /// Sunucu deseninden geçen öğelerin `matches` ile ayrıca süzülmesi gerekiyor mu
    pub fn needs_client_check(&self) -> bool {
        matches!(self.matcher, Matcher::Folded(_) | Matcher::Regex { .. })
    }

    /// Öğe filtreye uyuyor mu — her modda kesin. Sunucu deseni bunun üst kümesidir.
    pub fn matches(&self, item: &[u8]) -> bool {
        match &self.matcher {
            Matcher::All => true,
            Matcher::Glob => redis_glob(self.server.as_bytes(), item),
            Matcher::Folded(toks) => {
                let text = String::from_utf8_lossy(item);
                let chars: Vec<char> = text.chars().collect();
                wildcard(toks, &chars)
            }
            Matcher::Regex { re, fold } => {
                if *fold {
                    re.is_match(&fold_turkish_bytes(item))
                } else {
                    re.is_match(item)
                }
            }
        }
    }

    /// exact + büyük/küçük harf duyarlı → doğrudan anahtar (EXISTS kısayolu)
    pub fn exact_key(&self) -> Option<&[u8]> {
        self.exact.as_deref()
    }
}

/// Büyük/küçük harf duyarsız karşılaştırmanın karakter katlaması: Türkçe İ, I, ı → i; diğerleri Unicode küçük harf.
/// ASCII dışı bir karakter ASCII'ye katlanmaz (Kelvin K ≠ k) — sunucu deseninin `[kK]` kesinliği buna dayanır.
fn fold(c: char) -> char {
    match c {
        'I' | 'İ' | 'ı' => 'i',
        _ if c.is_ascii() => c.to_ascii_lowercase(),
        _ => {
            let mut lower = c.to_lowercase();
            match (lower.next(), lower.next()) {
                (Some(l), None) if !l.is_ascii() => l,
                _ => c,
            }
        }
    }
}

pub fn fold_text(text: &str) -> String {
    text.chars().map(fold).collect()
}

fn compile_regex(term: &str, case_sensitive: bool) -> AppResult<CompiledFilter> {
    let pattern = if case_sensitive { Cow::Borrowed(term) } else { Cow::Owned(term.replace(['İ', 'ı'], "i")) };
    let re = RegexBuilder::new(&pattern)
        .case_insensitive(!case_sensitive)
        .build()
        .map_err(|e| AppError::invalid(e.to_string()))?;
    let server = case_sensitive
        .then(|| regex_literal_prefix(term))
        .flatten()
        .map_or_else(|| "*".to_string(), |prefix| prefix + "*");
    Ok(CompiledFilter { server, exact: None, matcher: Matcher::Regex { re, fold: !case_sensitive } })
}

/// `^sabit…` ile başlayan, `|` içermeyen regex'in sabit öneki; sunucu bununla süzer.
fn regex_literal_prefix(re: &str) -> Option<String> {
    if re.contains('|') {
        return None;
    }
    let mut prefix = String::new();
    for c in re.strip_prefix('^')?.chars() {
        if matches!(c, '?' | '*' | '{') {
            prefix.pop();
            break;
        }
        if matches!(c, '\\' | '.' | '+' | '(' | ')' | '[' | ']' | '}' | '^' | '$') {
            break;
        }
        prefix.push(c);
    }
    (!prefix.is_empty()).then_some(prefix)
}

/// İ (C4 B0) ve ı (C4 B1) → i; büyük/küçük harf duyarsız regex gerisini kendisi halleder.
fn fold_turkish_bytes(item: &[u8]) -> Cow<'_, [u8]> {
    let is_dotted = |w: &[u8]| w[0] == 0xC4 && (w[1] == 0xB0 || w[1] == 0xB1);
    if !item.windows(2).any(is_dotted) {
        return Cow::Borrowed(item);
    }
    let mut out = Vec::with_capacity(item.len());
    let mut i = 0;
    while i < item.len() {
        if i + 1 < item.len() && is_dotted(&item[i..i + 2]) {
            out.push(b'i');
            i += 2;
        } else {
            out.push(item[i]);
            i += 1;
        }
    }
    Cow::Owned(out)
}

/// contains / prefix terimi: `*` ve `?` joker, gerisi düz metin
fn parse_term(term: &str) -> Vec<Tok> {
    term.chars()
        .map(|c| match c {
            '*' => Tok::Star,
            '?' => Tok::One,
            _ => Tok::Lit(c),
        })
        .collect()
}

/// Redis `stringmatchlen` ayrıştırmasının karakter düzeyindeki karşılığı (kaçış, `^`, aralık, kapanmamış sınıf).
fn parse_glob(pattern: &str) -> Vec<Tok> {
    let p: Vec<char> = pattern.chars().collect();
    let mut toks = Vec::new();
    let mut i = 0;
    while i < p.len() {
        match p[i] {
            '*' => toks.push(Tok::Star),
            '?' => toks.push(Tok::One),
            '[' => {
                let (tok, next) = parse_class(&p, i + 1);
                toks.push(tok);
                i = next;
                continue;
            }
            '\\' if i + 1 < p.len() => {
                i += 1;
                toks.push(Tok::Lit(p[i]));
            }
            c => toks.push(Tok::Lit(c)),
        }
        i += 1;
    }
    toks
}

fn parse_class(p: &[char], mut i: usize) -> (Tok, usize) {
    let neg = p.get(i) == Some(&'^');
    if neg {
        i += 1;
    }
    let mut items = Vec::new();
    while i < p.len() {
        if p[i] == '\\' && i + 1 < p.len() {
            items.push(ClassItem::Ch(p[i + 1]));
            i += 2;
        } else if p[i] == ']' {
            i += 1;
            break;
        } else if i + 2 < p.len() && p[i + 1] == '-' {
            let (a, b) = (p[i], p[i + 2]);
            items.push(ClassItem::Range(a.min(b), a.max(b)));
            i += 3;
        } else {
            items.push(ClassItem::Ch(p[i]));
            i += 1;
        }
    }
    (Tok::Class { neg, items }, i)
}

fn push_escaped(out: &mut String, c: char) {
    if matches!(c, '*' | '?' | '[' | ']' | '\\') {
        out.push('\\');
    }
    out.push(c);
}

fn push_star(out: &mut String) {
    if !out.ends_with('*') || out.ends_with("\\*") {
        out.push('*');
    }
}

/// Duyarlı desen; yalnızca Star / One / Lit içerir
fn emit_exact(toks: &[Tok]) -> String {
    let mut out = String::new();
    for tok in toks {
        match tok {
            Tok::Star => push_star(&mut out),
            Tok::One => out.push('?'),
            Tok::Lit(c) => push_escaped(&mut out, *c),
            Tok::Class { .. } => unreachable!("case-sensitive glob is passed through verbatim"),
        }
    }
    out
}

fn emit_folded(toks: &[Tok]) -> String {
    let mut out = String::new();
    for tok in toks {
        match tok {
            Tok::Star => push_star(&mut out),
            Tok::Lit(c) => emit_folded_char(&mut out, *c),
            Tok::Class { neg: false, items } => match ascii_class_set(items) {
                Some(set) => emit_class(&mut out, &set),
                None => push_any(&mut out),
            },
            Tok::One | Tok::Class { neg: true, .. } => push_any(&mut out),
        }
    }
    out
}

/// En az bir bayt: bir karakterin (1–4 bayt) üst kümesi
fn push_any(out: &mut String) {
    out.push('?');
    push_star(out);
}

fn emit_folded_char(out: &mut String, c: char) {
    if matches!(c, 'i' | 'I' | 'İ' | 'ı') || (!c.is_ascii() && !is_uncased(c)) {
        push_any(out);
    } else if c.is_ascii_alphabetic() {
        out.extend(['[', c.to_ascii_lowercase(), c.to_ascii_uppercase(), ']']);
    } else {
        push_escaped(out, c);
    }
}

/// Katlamada yalnızca kendisine eşit olan karakter; U+FFFD bozuk UTF-8'in yerine geçtiği için hariç.
fn is_uncased(c: char) -> bool {
    c != '\u{FFFD}' && c.to_lowercase().eq([c]) && c.to_uppercase().eq([c])
}

/// Sınıfın büyük/küçük harf kapanışıyla kabul ettiği ASCII baytları; ASCII dışı öğe ya da i/I varsa None.
fn ascii_class_set(items: &[ClassItem]) -> Option<[bool; 128]> {
    let mut set = [false; 128];
    for item in items {
        let (lo, hi) = match *item {
            ClassItem::Ch(c) => (c, c),
            ClassItem::Range(lo, hi) => (lo, hi),
        };
        if !hi.is_ascii() {
            return None;
        }
        for b in lo as u8..=hi as u8 {
            set[b as usize] = true;
            set[b.to_ascii_lowercase() as usize] = true;
            set[b.to_ascii_uppercase() as usize] = true;
        }
    }
    (!set[b'i' as usize]).then_some(set)
}

fn emit_class(out: &mut String, set: &[bool; 128]) {
    out.push('[');
    let mut b = 0u8;
    while b < 128 {
        if !set[b as usize] {
            b += 1;
            continue;
        }
        let mut end = b;
        while b.is_ascii_alphanumeric() && end < 127 && set[end as usize + 1] && same_run(b, end + 1) {
            end += 1;
        }
        if end - b >= 2 {
            out.extend([b as char, '-', end as char]);
        } else {
            for c in b..=end {
                if !c.is_ascii_alphanumeric() {
                    out.push('\\');
                }
                out.push(c as char);
            }
        }
        b = end + 1;
    }
    out.push(']');
}

fn same_run(a: u8, b: u8) -> bool {
    (a.is_ascii_digit() && b.is_ascii_digit())
        || (a.is_ascii_lowercase() && b.is_ascii_lowercase())
        || (a.is_ascii_uppercase() && b.is_ascii_uppercase())
}

fn fold_toks(toks: Vec<Tok>) -> Vec<Tok> {
    let fold_item = |item| match item {
        ClassItem::Ch(c) => ClassItem::Ch(fold(c)),
        range => range,
    };
    toks.into_iter()
        .map(|tok| match tok {
            Tok::Lit(c) => Tok::Lit(fold(c)),
            Tok::Class { neg, items } => Tok::Class { neg, items: items.into_iter().map(fold_item).collect() },
            other => other,
        })
        .collect()
}

impl Tok {
    /// `c` ham karakter; Lit ve sınıf harfleri katlanmış saklanır
    fn accepts(&self, c: char) -> bool {
        match self {
            Tok::Star | Tok::One => true,
            Tok::Lit(f) => fold(c) == *f,
            Tok::Class { neg, items } => {
                let f = fold(c);
                let hit = items.iter().any(|item| match *item {
                    ClassItem::Ch(x) => x == f,
                    ClassItem::Range(lo, hi) => {
                        let inside = |x: char| lo <= x && x <= hi;
                        inside(c) || inside(f) || single_upper(f).is_some_and(inside)
                    }
                });
                hit != *neg
            }
        }
    }
}

/// Büyük harfi tek karakterse ve ASCII'liği değişmiyorsa (ſ → S, ﬀ → FF sayılmaz)
fn single_upper(f: char) -> Option<char> {
    let mut upper = f.to_uppercase();
    match (upper.next(), upper.next()) {
        (Some(u), None) if u.is_ascii() == f.is_ascii() => Some(u),
        _ => None,
    }
}

/// Yıldız dışı her belirteç tam bir karakter tüketir; son yıldıza geri dönüşlü doğrusal arama.
fn wildcard(toks: &[Tok], s: &[char]) -> bool {
    let (mut ti, mut si) = (0, 0);
    let mut back: Option<(usize, usize)> = None;
    while si < s.len() {
        match toks.get(ti) {
            Some(Tok::Star) => {
                back = Some((ti, si));
                ti += 1;
            }
            Some(tok) if tok.accepts(s[si]) => {
                ti += 1;
                si += 1;
            }
            _ => match back {
                Some((bt, bs)) => {
                    ti = bt + 1;
                    si = bs + 1;
                    back = Some((bt, bs + 1));
                }
                None => return false,
            },
        }
    }
    toks[ti..].iter().all(|t| *t == Tok::Star)
}

/// Redis `stringmatchlen` (util.c, büyük/küçük harf duyarlı) — MATCH'in bayt bayt kopyası.
/// Redis gibi `*` boş öğeyle eşleşmez; SCAN tek `*` deseninde MATCH'i zaten atlar.
pub(crate) fn redis_glob(pattern: &[u8], s: &[u8]) -> bool {
    let mut skip_longer = false;
    glob_at(pattern, s, &mut skip_longer, 0)
}

fn glob_at(mut p: &[u8], mut s: &[u8], skip_longer: &mut bool, nesting: u32) -> bool {
    if nesting > 1000 {
        return false;
    }
    while !p.is_empty() && !s.is_empty() {
        match p[0] {
            b'*' => {
                while p.len() > 1 && p[1] == b'*' {
                    p = &p[1..];
                }
                if p.len() == 1 {
                    return true;
                }
                while !s.is_empty() {
                    if glob_at(&p[1..], s, skip_longer, nesting + 1) {
                        return true;
                    }
                    if *skip_longer {
                        return false;
                    }
                    s = &s[1..];
                }
                *skip_longer = true;
                return false;
            }
            b'?' => p = &p[1..],
            b'[' => {
                p = &p[1..];
                let not = p.first() == Some(&b'^');
                if not {
                    p = &p[1..];
                }
                let mut hit = false;
                loop {
                    if p.len() >= 2 && p[0] == b'\\' {
                        p = &p[1..];
                        hit |= p[0] == s[0];
                    } else if p.first() == Some(&b']') {
                        break;
                    } else if p.is_empty() {
                        break;
                    } else if p.len() >= 3 && p[1] == b'-' {
                        let (lo, hi) = (p[0].min(p[2]), p[0].max(p[2]));
                        hit |= lo <= s[0] && s[0] <= hi;
                        p = &p[2..];
                    } else {
                        hit |= p[0] == s[0];
                    }
                    p = &p[1..];
                }
                if hit == not {
                    return false;
                }
                if !p.is_empty() {
                    p = &p[1..];
                }
            }
            _ => {
                if p[0] == b'\\' && p.len() >= 2 {
                    p = &p[1..];
                }
                if p[0] != s[0] {
                    return false;
                }
                p = &p[1..];
            }
        }
        s = &s[1..];
        if s.is_empty() {
            while p.first() == Some(&b'*') {
                p = &p[1..];
            }
            break;
        }
    }
    p.is_empty() && s.is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn filter(mode: SearchMode, term: &str, case_sensitive: bool) -> CompiledFilter {
        let f = KeyFilter { mode, term: term.into(), case_sensitive, types: vec![] };
        CompiledFilter::compile(&f).unwrap()
    }

    use SearchMode::{Contains, Exact, Glob, Prefix, Regex as Rx};

    /// SCAN, tek `*` deseninde eşleştirme yapmaz (MATCH gönderilmez ya da Redis atlar)
    fn server_accepts(f: &CompiledFilter, item: &[u8]) -> bool {
        f.server_pattern() == "*" || redis_glob(f.server_pattern().as_bytes(), item)
    }

    #[test]
    fn redis_glob_matches_redis_semantics() {
        let cases: &[(&str, &str, bool)] = &[
            ("*", "", false),
            ("*", "abc", true),
            ("a*c", "abbbc", true),
            ("a*c", "abcd", false),
            ("a?c", "abc", true),
            ("a?c", "ac", false),
            ("h[ae]llo", "hello", true),
            ("h[^e]llo", "hello", false),
            ("h[^e]llo", "hallo", true),
            ("h[a-b]llo", "hbllo", true),
            ("h[b-a]llo", "hbllo", true),
            ("a\\*b", "a*b", true),
            ("a\\*b", "axb", false),
            ("a\\", "a\\", true),
            ("[\\]]", "]", true),
            ("[]a]", "a", false),
            ("[]", "a", false),
            ("[^]", "a", true),
            ("[abc", "b", true),
            ("x[", "x[", false),
            ("[a-]x", "]x", false),
            ("[a-]]", "]", true),
            ("[a-]]", "b", false),
            ("[a-]]", "_", true),
            ("[a-]x", "-x", false),
            ("**a", "ba", true),
            ("a**", "a", true),
            ("ş*", "şehir", true),
            ("?", "ş", false),
            ("??", "ş", true),
        ];
        for (p, s, want) in cases {
            assert_eq!(redis_glob(p.as_bytes(), s.as_bytes()), *want, "pattern {p:?} on {s:?}");
        }
    }

    #[test]
    fn server_patterns() {
        let cases: &[(SearchMode, &str, bool, &str)] = &[
            (Contains, "user", true, "*user*"),
            (Contains, "a*b?c", true, "*a*b?c*"),
            (Contains, "a[1]\\", true, "*a\\[1\\]\\\\*"),
            (Contains, "*x*", true, "*x*"),
            (Prefix, "user:", true, "user:*"),
            (Exact, "a*?[]\\", true, "a\\*\\?\\[\\]\\\\"),
            (Glob, "h[a-c]llo*", true, "h[a-c]llo*"),
            (Contains, "user", false, "*[uU][sS][eE][rR]*"),
            (Prefix, "Key:9", false, "[kK][eE][yY]:9*"),
            (Contains, "list", false, "*[lL]?*[sS][tT]*"),
            (Contains, "şehir", false, "*?*[eE][hH]?*[rR]*"),
            (Exact, "a?b", false, "[aA]\\?[bB]"),
            (Exact, "€5", false, "€5"),
            (Contains, "a?b", false, "*[aA]?*[bB]*"),
            (Glob, "h[a-c]x", false, "[hH][A-Ca-c][xX]"),
            (Glob, "[0-9a-f]", false, "[0-9A-Fa-f]"),
            (Glob, "[^x]y", false, "?*[yY]"),
            (Glob, "[a-z]", false, "?*"),
            (Glob, "[ş]", false, "?*"),
            (Glob, "[\\]-]", false, "[\\-\\]]"),
            (Glob, "a\\*", false, "[aA]\\*"),
            (Rx, "^user:\\d+$", true, "user:*"),
            (Rx, "^abc?d", true, "ab*"),
            (Rx, "^a|b", true, "*"),
            (Rx, "user", true, "*"),
            (Rx, "^user", false, "*"),
        ];
        for (mode, term, cs, want) in cases {
            assert_eq!(filter(*mode, term, *cs).server_pattern(), *want, "{mode:?} {term:?} cs={cs}");
        }
    }

    #[test]
    fn empty_and_star_terms_match_all() {
        for mode in [Contains, Prefix, Exact, Glob, Rx] {
            for cs in [true, false] {
                let f = filter(mode, "", cs);
                assert!(f.is_match_all() && f.matches(b"anything") && f.exact_key().is_none());
            }
        }
        assert!(filter(Glob, "*", true).is_match_all());
        assert!(filter(Contains, "*", false).is_match_all());
        assert!(!filter(Rx, ".*", true).is_match_all());
    }

    #[test]
    fn exact_key_only_for_case_sensitive_exact() {
        assert_eq!(filter(Exact, "a*b", true).exact_key(), Some(&b"a*b"[..]));
        assert!(filter(Exact, "a*b", false).exact_key().is_none());
        assert!(filter(Prefix, "a", true).exact_key().is_none());
    }

    #[test]
    fn invalid_regex_is_invalid_error() {
        let f = KeyFilter { mode: Rx, term: "a(".into(), case_sensitive: true, types: vec![] };
        let err = CompiledFilter::compile(&f).err().unwrap();
        assert_eq!(err.kind, crate::error::ErrorKind::Invalid);
    }

    #[test]
    fn client_matching_table() {
        let bin: &[u8] = b"\xff\x00user";
        let cases: &[(SearchMode, &str, bool, &[u8], bool)] = &[
            (Contains, "user", true, b"app:user:1", true),
            (Contains, "user", true, b"app:USER:1", false),
            (Contains, "user", false, b"app:USER:1", true),
            (Contains, "user", true, bin, true),
            (Contains, "user", false, bin, true),
            (Contains, "a?c", true, b"xabcx", true),
            (Contains, "a?c", true, "aşc".as_bytes(), false),
            (Contains, "a?c", false, "AŞC".as_bytes(), true),
            (Contains, "[1]", true, b"x[1]", true),
            (Contains, "[1]", true, b"x1", false),
            (Contains, "a\\b", true, b"a\\b", true),
            (Contains, "istanbul", false, "İSTANBUL".as_bytes(), true),
            (Contains, "istanbul", false, "ISTANBUL".as_bytes(), true),
            (Contains, "istanbul", false, "ıstanbul".as_bytes(), true),
            (Contains, "İstanbul", false, "istanbul".as_bytes(), true),
            (Contains, "ışık", false, "IŞIK".as_bytes(), true),
            (Contains, "ışık", true, "IŞIK".as_bytes(), false),
            (Contains, "şehir", false, "ŞEHİR:1".as_bytes(), true),
            (Contains, "şehir", false, "sehir".as_bytes(), false),
            (Contains, "k", false, "\u{212A}".as_bytes(), false),
            (Prefix, "user:", true, b"user:1", true),
            (Prefix, "user:", true, b"xuser:1", false),
            (Prefix, "Ü", false, "ülke".as_bytes(), true),
            (Exact, "a*b", true, b"a*b", true),
            (Exact, "a*b", true, b"axb", false),
            (Exact, "a*b", false, b"A*B", true),
            (Exact, "a*b", false, b"AxB", false),
            (Exact, "ğ", false, "Ğ".as_bytes(), true),
            (Exact, "ğ", false, "ğğ".as_bytes(), false),
            (Glob, "h[ae]llo", false, b"HELLO", true),
            (Glob, "h[^e]llo", false, b"HELLO", false),
            (Glob, "h[^e]llo", false, "HŞLLO".as_bytes(), true),
            (Glob, "[a-c]*", false, b"Bx", true),
            (Glob, "[a-z]", false, "İ".as_bytes(), true),
            (Glob, "[ç-ş]", false, "Ö".as_bytes(), true),
            (Glob, "a\\*", false, b"A*", true),
            (Glob, "a\\*", false, b"Ab", false),
            (Rx, "^user:\\d+$", true, b"user:42", true),
            (Rx, "^user:\\d+$", true, b"USER:42", false),
            (Rx, "^user:\\d+$", false, b"USER:42", true),
            (Rx, "istanbul", false, "İSTANBUL".as_bytes(), true),
            (Rx, "istanbul", false, "ıstanbul".as_bytes(), true),
            (Rx, "İSTANBUL", false, "istanbul".as_bytes(), true),
            (Rx, "user", false, bin, true),
            (Rx, "^\\xff", true, bin, false),
        ];
        for (mode, term, cs, item, want) in cases {
            let f = filter(*mode, term, *cs);
            assert_eq!(f.matches(item), *want, "{mode:?} {term:?} cs={cs} on {:?}", String::from_utf8_lossy(item));
            if *want {
                assert!(server_accepts(&f, item), "server narrower: {mode:?} {term:?} cs={cs}");
            }
        }
    }

    /// Katlamada ASCII olmayan bir karakter ancak "cased" bir karaktere katlanır; `is_uncased` güvenlidir.
    #[test]
    fn fold_targets_are_never_uncased() {
        for c in (0..=0x10FFFFu32).filter_map(char::from_u32) {
            let f = fold(c);
            if f != c {
                assert!(!is_uncased(f), "{c:?} folds to uncased {f:?}");
                assert_eq!(fold(f), f);
                assert!(!(f.is_ascii() && !c.is_ascii()) || f == 'i', "{c:?} folds into ASCII");
            }
        }
    }

    /// Her mod × duyarlılık × örnek kümesinde: `matches()` kabul ediyorsa sunucu deseni de kabul eder.
    #[test]
    fn server_pattern_is_never_narrower() {
        let terms = [
            "user", "User:1", "a*b", "a?b", "?", "*", "x[1]", "a\\b", "[a-c]x", "[^e]", "[]", "[ş-ü]", "[iI]", "[0-9]",
            "istanbul", "İSTANBUL", "ıI", "şehir", "ŞEHİR", "çğöü", "ß", "k", "s", "€", "\u{FFFD}", "[a-]", "[r-t]", "a\\",
            "^user", "^ab?c", "\\[", "ǅ", "Ω", "Å",
        ];
        let items: Vec<Vec<u8>> = [
            "user", "USER", "User:1", "uSeR:1:x", "ab", "a*b", "aXb", "aşb", "a\u{0130}b", "x[1]", "x1", "a\\b", "bx",
            "Bx", "e", "E", "Ş", "", "]", "-", "i", "I", "İ", "ı", "0", "9", "istanbul", "İSTANBUL", "ISTANBUL",
            "ıstanbul", "İstanbul", "ıI", "Iİ", "şehir", "ŞEHİR", "sehir", "ÇĞÖÜ", "çğöü", "ß", "ẞ", "SS", "K",
            "\u{212A}", "ſ", "ﬀ", "FF", "S", "€", "ǅ", "ǆ", "Ǆ", "ω", "Ω", "\u{2126}", "å", "Å", "\u{212B}", "[", "\\",
        ]
        .iter()
        .map(|s| s.as_bytes().to_vec())
        .chain([vec![0xff], vec![0xff, b'u', b's', b'e', b'r'], vec![b'a', 0xc4, b'b'], vec![0xef, 0xbf, 0xbd]])
        .collect();
        let mut checked = 0;
        for mode in [Contains, Prefix, Exact, Glob, Rx] {
            for cs in [true, false] {
                for term in terms {
                    let f = KeyFilter { mode, term: term.into(), case_sensitive: cs, types: vec![] };
                    let Ok(f) = CompiledFilter::compile(&f) else { continue };
                    for item in &items {
                        if f.matches(item) {
                            checked += 1;
                            assert!(
                                server_accepts(&f, item),
                                "{mode:?} {term:?} cs={cs}: server {:?} rejects {:?}",
                                f.server_pattern(),
                                String::from_utf8_lossy(item)
                            );
                        }
                    }
                }
            }
        }
        assert!(checked > 500);
    }

    /// Aynı özellik, özel karakter ağırlıklı rastgele terim ve öğelerle
    #[test]
    fn server_pattern_is_never_narrower_random() {
        let mut seed = 0x2545_F491_4F6C_DD1Du64;
        let mut next = |n: usize| {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            (seed % n as u64) as usize
        };
        let term_chars = ['a', 'A', 'i', 'I', 'İ', 'ı', 'ş', 'Ş', 'x', '1', '*', '?', '[', ']', '^', '-', '\\', 'k'];
        let item_chars = ['a', 'A', 'i', 'I', 'İ', 'ı', 'ş', 'Ş', 'x', '1', '[', ']', '-', '\\', '^', '\u{212A}', 'ſ'];
        let mut checked = 0;
        for _ in 0..3000 {
            let term: String = (0..1 + next(6)).map(|_| term_chars[next(term_chars.len())]).collect();
            let filters: Vec<CompiledFilter> = [Contains, Prefix, Exact, Glob]
                .into_iter()
                .flat_map(|mode| [true, false].map(|cs| filter(mode, &term, cs)))
                .collect();
            for _ in 0..20 {
                let mut item: Vec<u8> = (0..next(6))
                    .flat_map(|_| item_chars[next(item_chars.len())].to_string().into_bytes())
                    .collect();
                if next(8) == 0 {
                    item.insert(next(item.len() + 1), 0xff);
                }
                for f in filters.iter().filter(|f| f.matches(&item)) {
                    checked += 1;
                    assert!(server_accepts(f, &item), "{term:?}: server {:?} rejects {item:?}", f.server_pattern());
                }
            }
        }
        assert!(checked > 10_000);
    }
}
