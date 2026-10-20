//! Toplu yeniden adlandırma. Filtre kaynağında önce tüm eşleşenler toplanır — yeni adlar filtreye yeniden
//! uyabilir (`user:*` → `user:old:*`), tarama sürerken adlandırmak onları ikinci kez işlerdi.

use super::copy::{remove_sources, transfer};
use super::{int_of, key_cmds, note, Job, KeySource, Outcome, CHUNK};
use crate::error::{AppError, AppResult};
use crate::session::key_slot;
use regex::{Captures, Regex, RegexBuilder};
use std::collections::{HashMap, HashSet};
use tokio_util::sync::CancellationToken;

pub(crate) struct Renamer {
    re: Regex,
    fold: bool,
    template: Vec<Part>,
}

#[derive(Debug, PartialEq)]
enum Part {
    Lit(String),
    Group(usize),
    Named(String),
}

impl Renamer {
    /// Büyük/küçük harf duyarsızken Türkçe katlama: İ, I, ı, i birbirine eşittir.
    pub fn new(find: &str, replace: &str, regex: bool, case_sensitive: bool) -> AppResult<Renamer> {
        if find.is_empty() {
            return Err(AppError::invalid("find text is empty"));
        }
        let source = if regex { find.to_string() } else { regex::escape(find) };
        let source = if case_sensitive { source } else { source.replace(['İ', 'ı'], "i") };
        let re = RegexBuilder::new(&source)
            .case_insensitive(!case_sensitive)
            .build()
            .map_err(|e| AppError::invalid(e.to_string()))?;
        let template = if regex { parse_template(replace) } else { vec![Part::Lit(replace.to_string())] };
        Ok(Renamer { re, fold: !case_sensitive, template })
    }

    pub fn apply(&self, key: &str) -> String {
        let folded = (self.fold && key.contains(['İ', 'ı'])).then(|| fold_with_offsets(key));
        let (haystack, offsets) = match &folded {
            Some((text, offsets)) => (text.as_str(), Some(offsets.as_slice())),
            None => (key, None),
        };
        let original = |i: usize| offsets.map_or(i, |o| o[i]);
        let mut out = String::with_capacity(key.len());
        let mut last = 0;
        for caps in self.re.captures_iter(haystack) {
            let whole = caps.get(0).expect("group 0 always matches");
            out.push_str(&key[last..original(whole.start())]);
            self.expand(&caps, &mut out, |start, end| &key[original(start)..original(end)]);
            last = original(whole.end());
        }
        out.push_str(&key[last..]);
        out
    }

    fn expand<'k>(&self, caps: &Captures, out: &mut String, original: impl Fn(usize, usize) -> &'k str) {
        for part in &self.template {
            let group = match part {
                Part::Lit(text) => {
                    out.push_str(text);
                    continue;
                }
                Part::Group(index) => caps.get(*index),
                Part::Named(name) => caps.name(name),
            };
            if let Some(m) = group {
                out.push_str(original(m.start(), m.end()));
            }
        }
    }
}

/// İ ve ı → i; katlanmış metnin her bayt konumundan özgün konuma eşleme (uzunluk +1)
fn fold_with_offsets(key: &str) -> (String, Vec<usize>) {
    let mut text = String::with_capacity(key.len());
    let mut offsets = Vec::with_capacity(key.len() + 1);
    for (at, c) in key.char_indices() {
        if matches!(c, 'İ' | 'ı') {
            text.push('i');
            offsets.push(at);
        } else {
            text.push(c);
            offsets.extend(at..at + c.len_utf8());
        }
    }
    offsets.push(key.len());
    (text, offsets)
}

/// `regex` crate'inin `$1`, `$ad`, `${ad}`, `$$` sözdizimi
fn parse_template(replace: &str) -> Vec<Part> {
    let mut parts = Vec::new();
    let mut literal = String::new();
    let mut rest = replace;
    while let Some(at) = rest.find('$') {
        literal.push_str(&rest[..at]);
        rest = &rest[at..];
        if rest.as_bytes().get(1) == Some(&b'$') {
            literal.push('$');
            rest = &rest[2..];
            continue;
        }
        match capture_ref(rest) {
            Some((part, end)) => {
                if !literal.is_empty() {
                    parts.push(Part::Lit(std::mem::take(&mut literal)));
                }
                parts.push(part);
                rest = &rest[end..];
            }
            None => {
                literal.push('$');
                rest = &rest[1..];
            }
        }
    }
    literal.push_str(rest);
    if !literal.is_empty() {
        parts.push(Part::Lit(literal));
    }
    parts
}

fn capture_ref(text: &str) -> Option<(Part, usize)> {
    let (name, end) = if text[1..].starts_with('{') {
        let close = text[2..].find('}')? + 2;
        (&text[2..close], close + 1)
    } else {
        let len = text[1..].bytes().take_while(|b| b.is_ascii_alphanumeric() || *b == b'_').count();
        if len == 0 {
            return None;
        }
        (&text[1..1 + len], 1 + len)
    };
    let part = name.parse().map_or_else(|_| Part::Named(name.to_string()), Part::Group);
    Some((part, end))
}

pub(crate) struct Planned {
    pub key: Vec<u8>,
    pub target: Option<Vec<u8>>,
    pub note: &'static str,
}

/// Saf planlama: ikili ad, değişmeyen ad, aynı hedefe giden birden çok kaynak, hedefi taşınacak başka bir kaynak
pub(crate) fn plan(keys: Vec<Vec<u8>>, renamer: &Renamer) -> Vec<Planned> {
    let mut items: Vec<Planned> = keys
        .into_iter()
        .map(|key| match std::str::from_utf8(&key) {
            Err(_) => Planned { key, target: None, note: note::BINARY },
            Ok(text) => {
                let renamed = renamer.apply(text);
                if renamed == text {
                    Planned { key, target: None, note: note::UNCHANGED }
                } else {
                    Planned { key, target: Some(renamed.into_bytes()), note: note::NONE }
                }
            }
        })
        .collect();
    let mut per_target: HashMap<Vec<u8>, usize> = HashMap::new();
    for target in items.iter().filter_map(|item| item.target.as_ref()) {
        *per_target.entry(target.clone()).or_default() += 1;
    }
    for item in &mut items {
        if item.target.as_ref().is_some_and(|t| per_target[t] > 1) {
            item.note = note::DUPLICATE;
        }
    }
    let moving: HashSet<Vec<u8>> = items.iter().filter(|i| i.note.is_empty()).map(|i| i.key.clone()).collect();
    for item in &mut items {
        if item.note.is_empty() && item.target.as_ref().is_some_and(|t| moving.contains(t)) {
            item.note = note::EXISTS;
        }
    }
    items
}

pub(crate) async fn run(
    job: &mut Job<'_>,
    keys: &mut KeySource<'_>,
    renamer: &Renamer,
    overwrite: bool,
    token: &CancellationToken,
) -> AppResult<()> {
    let all = keys.collect_all(&mut job.rep, token).await?;
    let mut planned = plan(all, renamer).into_iter().peekable();
    while planned.peek().is_some() {
        if token.is_cancelled() {
            return Err(AppError::cancelled());
        }
        let chunk: Vec<Planned> = planned.by_ref().take(CHUNK).collect();
        if job.dry_run() {
            preview(job, chunk, overwrite).await?;
        } else {
            execute(job, chunk, overwrite).await?;
        }
        job.rep.progress();
    }
    Ok(())
}

async fn preview(job: &mut Job<'_>, mut chunk: Vec<Planned>, overwrite: bool) -> AppResult<()> {
    if !overwrite {
        let active = |p: &&Planned| p.note.is_empty();
        let targets: Vec<Vec<u8>> = chunk.iter().filter(active).filter_map(|p| p.target.clone()).collect();
        let replies = job.pipeline(key_cmds(&targets, "EXISTS")).await?;
        let mut exists = replies.into_iter().map(|r| r.ok().and_then(|v| int_of(&v)).unwrap_or(0) > 0);
        for item in chunk.iter_mut().filter(|p| p.note.is_empty()) {
            if exists.next() == Some(true) {
                item.note = note::EXISTS;
            }
        }
    }
    for item in chunk {
        job.rep.plan(item.key, item.target, item.note);
    }
    Ok(())
}

async fn execute(job: &mut Job<'_>, chunk: Vec<Planned>, overwrite: bool) -> AppResult<()> {
    let (active, skipped): (Vec<Planned>, Vec<Planned>) = chunk.into_iter().partition(|p| p.note.is_empty());
    for item in skipped {
        job.rep.skip(item.key, item.note);
    }
    let moves: Vec<(Vec<u8>, Vec<u8>)> =
        active.into_iter().filter_map(|p| Some((p.key, p.target?))).collect();
    let cluster = job.session.is_cluster();
    let (same_slot, cross_slot): (Vec<_>, Vec<_>) =
        moves.into_iter().partition(|(src, dst)| !cluster || key_slot(src) == key_slot(dst));
    rename_in_place(job, &same_slot, overwrite).await?;
    if !cross_slot.is_empty() {
        let pairs: Vec<(&[u8], &[u8])> = cross_slot.iter().map(|(s, d)| (s.as_slice(), d.as_slice())).collect();
        let mut outcomes = transfer(job.session, job.db, job.session, job.db, &pairs, overwrite).await?;
        let sources: Vec<Vec<u8>> = cross_slot.into_iter().map(|(src, _)| src).collect();
        remove_sources(job.session, job.db, &sources, &mut outcomes).await?;
        for (key, outcome) in sources.iter().zip(outcomes) {
            job.rep.record(key, outcome);
        }
    }
    Ok(())
}

/// RENAMENX (üzerine yazmadan) ya da RENAME; kaynak yoksa atlanır
async fn rename_in_place(job: &mut Job<'_>, moves: &[(Vec<u8>, Vec<u8>)], overwrite: bool) -> AppResult<()> {
    if moves.is_empty() {
        return Ok(());
    }
    let items = moves
        .iter()
        .map(|(src, dst)| {
            let mut cmd = redis::cmd(if overwrite { "RENAME" } else { "RENAMENX" });
            cmd.arg(src).arg(dst);
            (src.clone(), cmd)
        })
        .collect();
    let replies = job.pipeline(items).await?;
    for ((src, _), reply) in moves.iter().zip(replies) {
        let outcome = match reply {
            Ok(redis::Value::Int(0)) => Outcome::Skipped,
            Ok(_) => Outcome::Done,
            Err(err) if err.message.contains("no such key") => Outcome::Skipped,
            Err(err) => Outcome::Failed(err.message),
        };
        job.rep.record(src, outcome);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn renamed(find: &str, replace: &str, regex: bool, case_sensitive: bool, key: &str) -> String {
        Renamer::new(find, replace, regex, case_sensitive).unwrap().apply(key)
    }

    #[test]
    fn literal_and_regex_replacement() {
        let cases: &[(&str, &str, bool, bool, &str, &str)] = &[
            ("user", "member", false, true, "user:1:user", "member:1:member"),
            ("user", "member", false, true, "USER:1", "USER:1"),
            ("user", "member", false, false, "USER:1", "member:1"),
            ("a.b", "x", false, true, "a.b:aXb", "x:aXb"),
            ("$1", "$2", false, true, "k:$1", "k:$2"),
            (r"^user:(\d+)$", "member:$1", true, true, "user:42", "member:42"),
            (r"^(?P<kind>\w+):(\d+)", "${2}_$kind", true, true, "order:7:x", "7_order:x"),
            (r"(\d)", "$1a", true, true, "k1", "k"),
            (r"(\d)", "${1}a", true, true, "k1", "k1a"),
            (r"x", "$$", true, true, "axb", "a$b"),
            (r"x", "$", true, true, "axb", "a$b"),
            ("istanbul", "ankara", false, false, "İSTANBUL:1", "ankara:1"),
            ("istanbul", "ankara", false, false, "ıstanbul:İzmir", "ankara:İzmir"),
            ("İSTANBUL", "ankara", false, false, "Istanbul", "ankara"),
            ("istanbul", "ankara", false, true, "İSTANBUL", "İSTANBUL"),
            ("şehir", "il", false, false, "ŞEHİR:1", "il:1"),
            (r"^(i\w+):", "$1-", true, false, "İlçe:1", "İlçe-1"),
            (r"ı(.)", "<$1>", true, false, "aİb:ıc", "a<b>:<c>"),
        ];
        for (find, replace, regex, cs, key, want) in cases {
            assert_eq!(renamed(find, replace, *regex, *cs, key), *want, "{find:?} → {replace:?} on {key:?}");
        }
    }

    #[test]
    fn invalid_inputs() {
        assert!(Renamer::new("", "x", false, true).is_err());
        assert!(Renamer::new("(", "x", true, true).is_err());
        assert!(Renamer::new("(", "x", false, true).is_ok());
    }

    #[test]
    fn template_parsing_matches_regex_crate() {
        let re = Regex::new(r"(?P<a>x)(y)?").unwrap();
        for template in ["$1", "${1}", "$a", "${a}", "$1a", "$$", "$", "a$", "${", "${a", "$-", "$0$0", "${}"] {
            let renamer = Renamer { re: re.clone(), fold: false, template: parse_template(template) };
            let want = re.replace_all("_x_", template).into_owned();
            assert_eq!(renamer.apply("_x_"), want, "template {template:?}");
        }
    }

    fn keys(list: &[&[u8]]) -> Vec<Vec<u8>> {
        list.iter().map(|k| k.to_vec()).collect()
    }

    #[test]
    fn planner_notes() {
        let renamer = Renamer::new("old", "new", false, false).unwrap();
        let planned = plan(
            keys(&[b"old:1", b"OLD:2", b"other", b"\xffold", b"a:old", b"a:OLD", b"new:1", b"old:new:1", b"x:old"]),
            &renamer,
        );
        let notes: Vec<(&[u8], Option<&[u8]>, &str)> =
            planned.iter().map(|p| (p.key.as_slice(), p.target.as_deref(), p.note)).collect();
        assert_eq!(
            notes,
            vec![
                (&b"old:1"[..], Some(&b"new:1"[..]), note::NONE),
                (&b"OLD:2"[..], Some(&b"new:2"[..]), note::NONE),
                (&b"other"[..], None, note::UNCHANGED),
                (&b"\xffold"[..], None, note::BINARY),
                (&b"a:old"[..], Some(&b"a:new"[..]), note::DUPLICATE),
                (&b"a:OLD"[..], Some(&b"a:new"[..]), note::DUPLICATE),
                (&b"new:1"[..], None, note::UNCHANGED),
                (&b"old:new:1"[..], Some(&b"new:new:1"[..]), note::NONE),
                (&b"x:old"[..], Some(&b"x:new"[..]), note::NONE),
            ]
        );
    }

    #[test]
    fn planner_skips_targets_that_are_moving_sources() {
        let renamer = Renamer::new("a", "b", false, true).unwrap();
        let planned = plan(keys(&[b"a", b"b"]), &renamer);
        assert_eq!((planned[0].note, planned[1].note), (note::NONE, note::UNCHANGED), "b stays; EXISTS decides");
        let renamer = Renamer::new("x", "xx", false, true).unwrap();
        let planned = plan(keys(&[b"x", b"xx"]), &renamer);
        assert_eq!((planned[0].note, planned[1].note), (note::EXISTS, note::NONE), "xx moves to xxxx");
    }
}
