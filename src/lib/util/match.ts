// Arayüz tarafı eşleştirici: sonuçlarda eşleşen kısmı vurgulamak ve sahte arka uçta süzmek için.
// Kesin süzme arka uçtadır (src-tauri/src/pattern.rs); kurallar aynıdır.
import type { KeyFilter } from "$lib/api/types";

/** Türkçe dahil büyük/küçük harf katlama: İ, I, ı, i → i. Uzunluk korunur (vurgulama dizinleri kaymaz). */
export function foldCase(text: string): string {
  let out = "";
  for (const ch of text) {
    if (ch === "İ" || ch === "I" || ch === "ı") {
      out += "i";
      continue;
    }
    const lower = ch.toLowerCase();
    out += lower.length === ch.length ? lower : ch;
  }
  return out;
}

const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g;

function escapeRegex(text: string): string {
  return text.replace(REGEX_SPECIAL, "\\$&");
}

/** `*` ve `?` joker, gerisi düz metin */
function wildcardSource(term: string): string {
  let out = "";
  for (const ch of term) {
    if (ch === "*") out += ".*?";
    else if (ch === "?") out += ".";
    else out += escapeRegex(ch);
  }
  return out;
}

/** Redis glob → RegExp kaynağı (`*`, `?`, `[...]`, `[^...]`, `\` kaçışı) */
export function globSource(glob: string): string {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "\\" && i + 1 < glob.length) {
      out += escapeRegex(glob[++i]);
    } else if (ch === "*") {
      out += ".*";
    } else if (ch === "?") {
      out += ".";
    } else if (ch === "[") {
      const end = glob.indexOf("]", i + 2);
      if (end < 0) {
        out += "\\[";
        continue;
      }
      let body = glob.slice(i + 1, end);
      const negate = body.startsWith("^");
      if (negate) body = body.slice(1);
      out += `[${negate ? "^" : ""}${body.replace(/[\\\]]/g, "\\$&")}]`;
      i = end;
    } else {
      out += escapeRegex(ch);
    }
  }
  return out;
}

export interface Matcher {
  test(text: string): boolean;
  /** Vurgulanacak [başlangıç, bitiş) aralıkları */
  ranges(text: string): [number, number][];
}

const ALL: Matcher = { test: () => true, ranges: () => [] };

export function compileMatcher(filter: Pick<KeyFilter, "mode" | "term" | "caseSensitive">): Matcher {
  const { mode, term, caseSensitive } = filter;
  if (!term) return ALL;
  const prep = caseSensitive ? (s: string) => s : foldCase;

  let source: string;
  let flags = "g";
  switch (mode) {
    case "contains":
      source = wildcardSource(prep(term));
      break;
    case "prefix":
      source = `^${wildcardSource(prep(term))}`;
      break;
    case "exact":
      source = `^${escapeRegex(prep(term))}$`;
      break;
    case "glob":
      source = `^${globSource(prep(term))}$`;
      break;
    case "regex":
      source = term;
      flags = caseSensitive ? "gu" : "giu";
      break;
  }
  let regex: RegExp;
  try {
    regex = new RegExp(source, flags);
  } catch {
    return { test: () => false, ranges: () => [] };
  }
  const subject = mode === "regex" ? (s: string) => s : prep;

  return {
    test(text) {
      regex.lastIndex = 0;
      return regex.test(subject(text));
    },
    ranges(text) {
      const haystack = subject(text);
      const out: [number, number][] = [];
      regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(haystack)) !== null) {
        if (m[0].length === 0) {
          regex.lastIndex++;
          continue;
        }
        out.push([m.index, m.index + m[0].length]);
        if (out.length > 20) break;
      }
      return out;
    },
  };
}
