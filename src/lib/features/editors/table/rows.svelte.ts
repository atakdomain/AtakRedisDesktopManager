// Koleksiyon düzenleyicilerinin satır deposu ve çoklu seçimi. Büyük listeler vekil dışında tutulur;
// değişiklik `version` ile duyurulur (yüz binlerce satırda kopyalamadan ekleme).
import { isMac } from "$lib/state/commands.svelte";

export class RowStore<T> {
  private items: T[] = [];
  private ids = new Set<string>();
  version = $state(0);

  constructor(private readonly idOf: (item: T) => string) {}

  get length(): number {
    void this.version;
    return this.items.length;
  }

  at(index: number): T | undefined {
    void this.version;
    return this.items[index];
  }

  idAt(index: number): string {
    void this.version;
    const item = this.items[index];
    return item === undefined ? "" : this.idOf(item);
  }

  all(): readonly T[] {
    void this.version;
    return this.items;
  }

  has(id: string): boolean {
    void this.version;
    return this.ids.has(id);
  }

  indexOf(id: string): number {
    void this.version;
    return this.ids.has(id) ? this.items.findIndex((item) => this.idOf(item) === id) : -1;
  }

  /** Tekrarları atlar (SCAN aynı öğeyi birden çok verebilir); eklenen sayısı */
  append(batch: readonly T[]): number {
    let added = 0;
    for (const item of batch) {
      const id = this.idOf(item);
      if (this.ids.has(id)) continue;
      this.ids.add(id);
      this.items.push(item);
      added++;
    }
    if (added) this.version++;
    return added;
  }

  prepend(item: T): void {
    const id = this.idOf(item);
    if (this.ids.has(id)) return;
    this.ids.add(id);
    this.items.unshift(item);
    this.version++;
  }

  /** `id`'li öğeyi değiştirir (kimlik değişebilir: yeniden adlandırma) */
  replace(id: string, item: T): void {
    const index = this.items.findIndex((x) => this.idOf(x) === id);
    const nextId = this.idOf(item);
    if (index < 0) {
      this.append([item]);
      return;
    }
    if (nextId !== id && this.ids.has(nextId)) {
      // Hedef zaten varsa (üzerine yazılan alan) eskisini kaldır
      const other = this.items.findIndex((x) => this.idOf(x) === nextId);
      this.items.splice(other, 1);
    }
    const at = this.items.findIndex((x) => this.idOf(x) === id);
    this.items[at] = item;
    this.ids.delete(id);
    this.ids.add(nextId);
    this.version++;
  }

  remove(ids: ReadonlySet<string>): number {
    const before = this.items.length;
    this.items = this.items.filter((item) => !ids.has(this.idOf(item)));
    for (const id of ids) this.ids.delete(id);
    if (this.items.length !== before) this.version++;
    return before - this.items.length;
  }

  clear(): void {
    this.items = [];
    this.ids.clear();
    this.version++;
  }
}

interface ClickLike {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

/** Tık / Shift / Ctrl(⌘) ve onay kutularıyla çoklu seçim. Kimlikler sabit; `cursor` görünen sıradaki konumdur. */
export class RowSelection {
  ids = $state.raw(new Set<string>());
  cursor = $state(-1);
  private anchor = -1;

  constructor(
    private readonly idAt: (index: number) => string,
    private readonly count: () => number,
  ) {}

  has(id: string): boolean {
    return this.ids.has(id);
  }

  get size(): number {
    return this.ids.size;
  }

  click(index: number, e: ClickLike): void {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (e.shiftKey && this.anchor >= 0) this.range(this.anchor, index, mod);
    else if (mod) this.toggle(index);
    else this.single(index);
  }

  single(index: number): void {
    this.ids = new Set(index >= 0 ? [this.idAt(index)] : []);
    this.anchor = index;
    this.cursor = index;
  }

  toggle(index: number): void {
    const id = this.idAt(index);
    const next = new Set(this.ids);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.ids = next;
    this.anchor = index;
    this.cursor = index;
  }

  range(from: number, to: number, additive = false): void {
    const next = additive ? new Set(this.ids) : new Set<string>();
    const [a, b] = from <= to ? [from, to] : [to, from];
    for (let i = a; i <= b; i++) next.add(this.idAt(i));
    this.ids = next;
    this.cursor = to;
  }

  all(): void {
    const n = this.count();
    const next = new Set<string>();
    for (let i = 0; i < n; i++) next.add(this.idAt(i));
    this.ids = next;
  }

  /** Klavye: imleci taşı; Shift ile aralığı genişlet */
  move(to: number, extend: boolean): void {
    const n = this.count();
    if (n === 0) return;
    const index = Math.max(0, Math.min(n - 1, to));
    if (extend && this.anchor >= 0) this.range(this.anchor, index);
    else this.single(index);
  }

  /** Artık var olmayan kimlikleri atar */
  retain(exists: (id: string) => boolean): void {
    const next = new Set([...this.ids].filter(exists));
    if (next.size !== this.ids.size) this.ids = next;
    if (this.cursor >= this.count()) this.cursor = this.count() - 1;
  }

  reset(): void {
    this.ids = new Set();
    this.cursor = -1;
    this.anchor = -1;
  }

  /** İmleç satırının kimliği (detay paneli bunu gösterir) */
  cursorId(): string | null {
    return this.cursor >= 0 && this.cursor < this.count() ? this.idAt(this.cursor) : null;
  }
}
