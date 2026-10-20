// Konsol geçmişi: tekrarsız, en yeni sonda, en fazla 500 kayıt. Parola içeren komutlar diske yazılmaz.

export const HISTORY_CAP = 500;

export function pushHistory(list: readonly string[], line: string, cap = HISTORY_CAP): string[] {
  const entry = line.trim();
  if (!entry) return [...list];
  const next = list.filter((x) => x !== entry);
  next.push(entry);
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/** redis-cli gibi: AUTH, HELLO … AUTH, ACL SETUSER, MIGRATE … AUTH, CONFIG SET requirepass/masterauth */
export function isSensitive(line: string): boolean {
  const words = line.trim().split(/\s+/).map((w) => w.replace(/^["']|["']$/g, "").toUpperCase());
  const [cmd, sub] = words;
  if (cmd === "AUTH") return true;
  if (cmd === "ACL" && sub === "SETUSER") return true;
  if ((cmd === "HELLO" || cmd === "MIGRATE") && (words.includes("AUTH") || words.includes("AUTH2"))) return true;
  if (cmd === "CONFIG" && sub === "SET") return words.slice(2).some((w) => w === "REQUIREPASS" || w === "MASTERAUTH" || w === "MASTERUSER");
  return false;
}

/**
 * ↑/↓ gezinme. `prefix` (gezinme başlarkenki taslak) ile başlayan kayıtlar arasında dolaşır.
 * `index`: -1 taslak, 0 en yeni eşleşme, 1 bir önceki … `dir` 1 = daha eski, -1 = daha yeni.
 * Gidilecek yer yoksa null.
 */
export function stepHistory(list: readonly string[], prefix: string, index: number, dir: 1 | -1): { index: number; value: string } | null {
  const p = prefix.toLowerCase();
  const matches: string[] = [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (!p || list[i].toLowerCase().startsWith(p)) matches.push(list[i]);
  }
  const next = index + dir;
  if (next < -1 || next >= matches.length) return null;
  return { index: next, value: next === -1 ? prefix : matches[next] };
}

/** Ctrl+R araması: metni içeren kayıtlar, en yeni önce. */
export function searchHistory(list: readonly string[], query: string, limit = 50): string[] {
  const q = query.trim().toLowerCase();
  const out: string[] = [];
  for (let i = list.length - 1; i >= 0 && out.length < limit; i--) {
    if (!q || list[i].toLowerCase().includes(q)) out.push(list[i]);
  }
  return out;
}
