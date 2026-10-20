// *SCAN tabanlı sayfalama (hash, set, zset süzgeci): imleçle ilerler, tekrarları atar, "tümünü yükle" durdurulabilir.
import { RowStore } from "./rows.svelte";

export interface ScanPage<T> {
  cursor: string;
  total: number;
  items: T[];
}

/** Bir "daha fazla" adımında hedeflenen yeni öğe sayısı (MATCH seyrekse birkaç tur atılır) */
const TARGET = 300;
const MAX_ROUNDS = 40;
export const SCAN_COUNT = 1000;

export class ScanLoader<T> {
  readonly store: RowStore<T>;
  loading = $state(false);
  done = $state(false);
  total = $state(0);
  /** En az bir sayfa geldi */
  ready = $state(false);

  private cursor = "";
  private generation = 0;
  private stopped = false;

  constructor(
    idOf: (item: T) => string,
    private readonly fetchPage: (cursor: string) => Promise<ScanPage<T>>,
    private readonly onError: (err: unknown) => void,
  ) {
    this.store = new RowStore(idOf);
  }

  async reset(): Promise<void> {
    this.generation++;
    this.store.clear();
    this.cursor = "";
    this.done = false;
    this.ready = false;
    this.loading = false;
    await this.more();
  }

  async more(all = false): Promise<void> {
    if (this.loading || (this.done && this.ready)) return;
    const generation = this.generation;
    this.loading = true;
    this.stopped = false;
    let added = 0;
    let rounds = 0;
    try {
      do {
        const page = await this.fetchPage(this.cursor);
        if (generation !== this.generation) return;
        this.cursor = page.cursor;
        this.done = page.cursor === "";
        this.total = page.total;
        this.ready = true;
        added += this.store.append(page.items);
        rounds++;
      } while (!this.done && !this.stopped && (all || (added < TARGET && rounds < MAX_ROUNDS)));
    } catch (err) {
      if (generation === this.generation) this.onError(err);
    } finally {
      if (generation === this.generation) this.loading = false;
    }
  }

  stop(): void {
    this.stopped = true;
  }
}
