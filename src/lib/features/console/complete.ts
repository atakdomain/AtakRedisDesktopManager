// Komut adı tamamlama (sıralama) ve redis-cli tarzı argüman ipucu.
import { COMMANDS, CONTAINERS, lookupCommand, type CommandSpec } from "./commands";
import { tokenize } from "./parse";

/** İmleç hâlâ komut adındaysa (1–2 kelime) sorgu metni; değilse null. */
export function commandQuery(line: string): string | null {
  const { tokens, trailingSpace, error } = tokenize(line);
  if (error || tokens.length === 0) return null;
  if (tokens.length === 1 && !trailingSpace) return tokens[0];
  if (CONTAINERS.has(tokens[0].toUpperCase())) {
    if (tokens.length === 1) return `${tokens[0]} `;
    if (tokens.length === 2 && !trailingSpace) return `${tokens[0]} ${tokens[1]}`;
  }
  return null;
}

function isSubsequence(needle: string, haystack: string): boolean {
  let j = 0;
  for (let i = 0; i < haystack.length && j < needle.length; i++) {
    if (haystack[i] === needle[j]) j++;
  }
  return j === needle.length;
}

function score(name: string, q: string): number {
  const trimmed = q.trimEnd();
  if (name === trimmed) return 1000;
  if (name.startsWith(q)) return 800 - Math.min(100, name.length - q.length);
  if (trimmed.includes(" ")) return 0;
  const words = name.split(/[ ._]/);
  if (words.some((w, i) => i > 0 && w.startsWith(trimmed))) return 500 - Math.min(100, name.length - trimmed.length);
  if (name.includes(trimmed)) return 300 - Math.min(100, name.length - trimmed.length);
  if (trimmed.length >= 2 && isSubsequence(trimmed, name)) return 100 - Math.min(90, name.length - trimmed.length);
  return 0;
}

/** Tam eşleşme > önek > kelime başı > içerir > sıralı harfler; yaygın komutlar ve kısa adlar öne. */
export function rankCommands(query: string, limit = 8, catalog: readonly CommandSpec[] = COMMANDS): CommandSpec[] {
  const q = query.toUpperCase().replace(/\s+/g, " ").trimStart();
  if (!q.trim()) return [];
  const scored: { spec: CommandSpec; s: number }[] = [];
  for (const spec of catalog) {
    const s = score(spec.name, q);
    if (s > 0) scored.push({ spec, s: s + (spec.common ? 50 : 0) });
  }
  scored.sort((a, b) => b.s - a.s || a.spec.name.length - b.spec.name.length || a.spec.name.localeCompare(b.spec.name));
  return scored.slice(0, limit).map((x) => x.spec);
}

/** Kullanıcı küçük harfle yazıyorsa tamamlama da küçük harf olur. */
export function matchCase(typed: string, text: string): string {
  return /[A-Z]/.test(typed) || typed.trim() === "" ? text : text.toLowerCase();
}

/** Sözdizimini üst düzey gruplara böler: `key`, `[NX | XX]`, `<LEFT | RIGHT>` … */
export function syntaxGroups(args: string): string[] {
  const groups: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of args) {
    if (ch === "[" || ch === "<") depth++;
    if (ch === "]" || ch === ">") depth = Math.max(0, depth - 1);
    if (ch === " " && depth === 0) {
      if (current) groups.push(current);
      current = "";
    } else current += ch;
  }
  if (current) groups.push(current);
  return groups;
}

export interface ArgHint {
  spec: CommandSpec;
  /** Komut adının kaç token sürdüğü */
  words: number;
  /** Henüz yazılmamış argümanların sözdizimi */
  remaining: string;
}

/** redis-cli ipucu: yazılan argüman kadar zorunlu grup düşer; ilk isteğe bağlı grupta durur. */
export function argHint(line: string): ArgHint | null {
  const { tokens, error } = tokenize(line);
  if (error) return null;
  const found = lookupCommand(tokens);
  if (!found) return null;
  const groups = syntaxGroups(found.spec.args);
  let typed = tokens.length - found.words;
  while (typed > 0 && groups.length > 0 && !groups[0].startsWith("[")) {
    groups.shift();
    typed--;
  }
  return { spec: found.spec, words: found.words, remaining: groups.join(" ") };
}

/** Satırın sonunda gösterilecek soluk metin (tamamlama + argüman ipucu). */
export function ghostText(line: string, top: CommandSpec | undefined): string {
  if (!line.trim()) return "";
  const query = commandQuery(line);
  if (query !== null && top) {
    const q = query.toUpperCase().replace(/\s+/g, " ").trimStart();
    if (top.name.startsWith(q) && top.name !== q.trimEnd()) {
      const rest = matchCase(query, top.name.slice(q.length));
      return rest + (top.args ? ` ${top.args}` : "");
    }
  }
  const hint = argHint(line);
  if (!hint || !hint.remaining) return "";
  return (/\s$/.test(line) ? "" : " ") + hint.remaining;
}

/** Seçilen komutu satıra yerleştirir: "hge" → "hgetall " */
export function acceptCommand(line: string, spec: CommandSpec): string {
  const query = commandQuery(line) ?? line;
  return `${matchCase(query, spec.name)} `;
}
