// Sıra (dizin) tabanlı tembel sayfalama: list (LRANGE) ve zset (ZRANGE). Toplam baştan bilinir;
// kaydırma çubuğu tüm listeyi temsil eder, görünen sayfalar istendikçe yüklenir.

export interface IndexPage<T> {
  total: number;
  items: T[];
}

export class PagedLoader<T> {
  total = $state(0);
  version = $state(0);
  ready = $state(false);
  loadingAll = $state(false);

  private pages = new Map<number, T[]>();
  private pending = new Set<number>();
  private generation = 0;
  private stopped = false;
  private visible: [number, number] = [0, 0];

  constructor(
    private readonly fetch: (start: number, count: number) => Promise<IndexPage<T>>,
    private readonly onError: (err: unknown) => void,
    readonly pageSize = 200,
  ) {}

  at(index: number): T | undefined {
    void this.version;
    return this.pages.get(Math.floor(index / this.pageSize))?.[index % this.pageSize];
  }

  /** Yüklenmiş öğe sayısı */
  get loaded(): number {
    void this.version;
    let n = 0;
    for (const page of this.pages.values()) n += page.length;
    return n;
  }

  /** Yüklenmiş öğeler dizin sırasıyla (istemci süzgeci için) */
  loadedEntries(): { index: number; item: T }[] {
    void this.version;
    const out: { index: number; item: T }[] = [];
    for (const p of [...this.pages.keys()].sort((a, b) => a - b)) {
      this.pages.get(p)!.forEach((item, i) => out.push({ index: p * this.pageSize + i, item }));
    }
    return out;
  }

  /** Görünen aralığın (± bir sayfa) yüklü olmasını sağlar */
  ensure(start: number, end: number): void {
    this.visible = [start, end];
    const first = Math.max(0, Math.floor((start - 20) / this.pageSize));
    const last = Math.floor((end + 20) / this.pageSize);
    for (let p = first; p <= last; p++) {
      if (p * this.pageSize < Math.max(this.total, 1)) void this.load(p);
    }
  }

  private async load(page: number): Promise<void> {
    if (this.pages.has(page) || this.pending.has(page)) return;
    const generation = this.generation;
    this.pending.add(page);
    try {
      const result = await this.fetch(page * this.pageSize, this.pageSize);
      if (generation !== this.generation) return;
      this.total = result.total;
      this.pages.set(page, result.items);
      this.ready = true;
      this.version++;
    } catch (err) {
      if (generation === this.generation) this.onError(err);
    } finally {
      this.pending.delete(page);
    }
  }

  /** Baştan: önbellek atılır, ilk sayfa ve görünen sayfalar yeniden istenir */
  async reset(): Promise<void> {
    this.generation++;
    this.pages.clear();
    this.pending.clear();
    this.version++;
    await this.load(0);
    const [start, end] = this.visible;
    if (end > this.pageSize) this.ensure(start, end);
  }

  /** Tüm sayfalar sırayla (durdurulabilir) */
  async loadAll(): Promise<void> {
    this.loadingAll = true;
    this.stopped = false;
    const generation = this.generation;
    try {
      for (let p = 0; p * this.pageSize < this.total; p++) {
        if (this.stopped || generation !== this.generation) break;
        await this.load(p);
      }
    } finally {
      this.loadingAll = false;
    }
  }

  stop(): void {
    this.stopped = true;
  }

  /** Yüklü bir öğeyi yerinde günceller (LSET sonrası) */
  update(index: number, item: T): void {
    const page = this.pages.get(Math.floor(index / this.pageSize));
    if (!page) return;
    page[index % this.pageSize] = item;
    this.version++;
  }

  get allLoaded(): boolean {
    void this.version;
    return this.ready && this.loaded >= this.total;
  }
}
