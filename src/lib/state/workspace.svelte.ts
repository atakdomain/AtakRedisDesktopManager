// Bağlantı başına çalışma alanı: seçili db, arama süzgeci, yüklenen anahtarlar, tür/TTL önbelleği, seçim ve sekmeler.
// Büyük anahtar listeleri vekil (proxy) dışında tutulur; değişiklik `version` sayacıyla duyurulur.
import { api, ApiError } from "$lib/api";
import { bytesId, label as labelOf } from "$lib/api/bytes";
import type { DbInfo, KeyFilter, KeyMeta, KeyType, RBytes } from "$lib/api/types";
import { connections } from "./connections.svelte";
import { settings } from "./settings.svelte";
import { toastError } from "./toasts.svelte";
import { uid } from "$lib/util/id";

export type TabKind = "key" | "server" | "console" | "slowlog" | "pubsub" | "bulk";

export interface Tab {
  id: string;
  kind: TabKind;
  title: string;
  key?: RBytes;
  keyType?: KeyType;
  /** Önizleme sekmesi: italik, bir sonraki tek tıklamada yerini başka anahtara bırakır */
  preview: boolean;
  dirty: boolean;
  /** Özelliğe özgü başlangıç verisi (ör. toplu işlem ön ayarı) */
  data?: unknown;
}

export interface ScanState {
  running: boolean;
  cursor: string;
  done: boolean;
  matched: number;
  scanned: number;
  elapsedMs: number;
  error: ApiError | null;
}

const META_CHUNK = 300;

export class Workspace {
  readonly connectionId: string;

  db = $state(0);
  dbs = $state.raw<DbInfo[]>([]);
  filter = $state<KeyFilter>({ mode: "contains", term: "", caseSensitive: false, types: [] });
  scan = $state<ScanState>({ running: false, cursor: "", done: false, matched: 0, scanned: 0, elapsedMs: 0, error: null });

  /** Yüklenen anahtarlar (tekrarsız, geliş sırasıyla). Okurken `keyList` kullanın. */
  private keys: RBytes[] = [];
  private byId = new Map<string, RBytes>();
  private version = $state(0);

  private meta = new Map<string, KeyMeta>();
  private metaVersion = $state(0);
  private metaPending = new Set<string>();
  private metaInflight = new Set<string>();
  private metaTimer: ReturnType<typeof setTimeout> | undefined;

  selection = $state.raw(new Set<string>());
  /** Shift ile aralık seçiminin başlangıcı */
  anchor = $state<string | null>(null);
  /** Gmail tarzı: süzgece uyan sunucudaki TÜM anahtarlar seçili (yalnızca yüklenenler değil) */
  allMatching = $state(false);
  expanded = $state.raw(new Set<string>());

  tabs = $state<Tab[]>([]);
  activeTabId = $state<string | null>(null);

  private scanId: string | null = null;
  /** cancelScan/search her çağrıldığında artar; loadAll döngüsü buna bakarak durur */
  private generation = 0;
  private initialized = false;

  constructor(connectionId: string) {
    this.connectionId = connectionId;
    this.filter.caseSensitive = settings.caseSensitive;
    this.filter.mode = settings.searchMode;
  }

  get keyList(): readonly RBytes[] {
    void this.version;
    return this.keys;
  }

  get keyCount(): number {
    void this.version;
    return this.keys.length;
  }

  keyById(id: string): RBytes | undefined {
    return this.byId.get(id);
  }

  get activeTab(): Tab | undefined {
    return this.tabs.find((t) => t.id === this.activeTabId);
  }

  get readOnly(): boolean {
    return connections.byId(this.connectionId)?.readOnly ?? false;
  }

  get separator(): string {
    return connections.byId(this.connectionId)?.separator || ":";
  }

  /** Bağlantı kurulduktan sonra bir kez: db listesi + ilk arama */
  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    this.db = connections.byId(this.connectionId)?.db ?? 0;
    await this.loadDbs();
    await this.search();
  }

  async loadDbs(): Promise<void> {
    try {
      this.dbs = await api.session.dbList(this.connectionId);
    } catch (err) {
      this.handleError(err);
    }
  }

  async setDb(db: number): Promise<void> {
    if (db === this.db) return;
    this.db = db;
    this.tabs = this.tabs.filter((t) => t.kind !== "key");
    if (!this.tabs.some((t) => t.id === this.activeTabId)) this.activeTabId = this.tabs.at(-1)?.id ?? null;
    await this.search();
  }

  // ───────────── tarama ─────────────

  /** Süzgeç değişince baştan arar; önceki tarama iptal edilir. */
  async search(): Promise<void> {
    this.cancelScan();
    this.keys = [];
    this.byId.clear();
    this.meta.clear();
    this.metaVersion++;
    this.version++;
    this.selection = new Set();
    this.allMatching = false;
    this.anchor = null;
    this.scan = { running: false, cursor: "", done: false, matched: 0, scanned: 0, elapsedMs: 0, error: null };
    await this.runScan("", settings.scanLimit);
  }

  async loadMore(): Promise<void> {
    if (this.scan.running || this.scan.done) return;
    await this.runScan(this.scan.cursor, settings.scanLimit);
  }

  /** Tarama bitene dek sürer; `cancelScan` ile durdurulur. */
  async loadAll(): Promise<void> {
    const generation = this.generation;
    while (!this.scan.done && !this.scan.error && generation === this.generation) {
      await this.runScan(this.scan.cursor, 50000);
    }
  }

  cancelScan(): void {
    this.generation++;
    if (this.scanId) void api.keys.cancelScan(this.scanId);
    this.scanId = null;
    this.scan.running = false;
  }

  private async runScan(cursor: string, limit: number): Promise<void> {
    const scanId = uid();
    const generation = this.generation;
    const current = () => generation === this.generation;
    this.scanId = scanId;
    this.scan.running = true;
    this.scan.error = null;
    const started = performance.now();
    const baseScanned = this.scan.scanned;
    let received = 0;
    let pending: RBytes[] = [];
    let frame = 0;
    const flush = () => {
      frame = 0;
      if (!current() || pending.length === 0) return;
      this.appendKeys(pending);
      pending = [];
    };
    try {
      const result = await api.keys.scan(this.connectionId, this.db, $state.snapshot(this.filter), cursor, limit, scanId, (batch) => {
        if (!current()) return;
        received += batch.keys.length;
        pending.push(...batch.keys);
        this.scan.scanned = Math.max(this.scan.scanned, baseScanned + batch.scanned);
        frame ||= requestAnimationFrame(flush);
      });
      // Kanal mesajları komutun yanıtından sonra da gelebilir; bu çağrının tüm parçaları gelene dek kısa süre bekle
      await waitFor(() => received >= result.matched || !current(), 2000);
      if (!current()) return;
      cancelAnimationFrame(frame);
      flush();
      this.scan.cursor = result.cursor;
      this.scan.done = result.done;
      this.scan.scanned = baseScanned + result.scanned;
    } catch (err) {
      if (!current()) return;
      flush();
      if (!(err instanceof ApiError && err.kind === "cancelled")) {
        this.scan.error = err instanceof ApiError ? err : new ApiError("internal", String(err));
        this.handleError(err, false);
      }
    } finally {
      if (this.scanId === scanId) {
        this.scan.running = false;
        this.scan.elapsedMs += performance.now() - started;
        this.scanId = null;
      }
    }
  }

  private appendKeys(batch: RBytes[]): void {
    let added = 0;
    for (const key of batch) {
      const id = bytesId(key);
      if (this.byId.has(id)) continue;
      this.byId.set(id, key);
      this.keys.push(key);
      added++;
    }
    if (added) {
      this.scan.matched = this.keys.length;
      this.version++;
    }
  }

  // ───────────── yerel güncellemeler (işlemlerden sonra) ─────────────

  addKey(key: RBytes, meta?: KeyMeta): void {
    this.appendKeys([key]);
    if (meta) this.setMeta(bytesId(key), meta);
  }

  removeKeys(ids: Iterable<string>): void {
    const gone = new Set(ids);
    if (gone.size === 0) return;
    this.keys = this.keys.filter((k) => !gone.has(bytesId(k)));
    for (const id of gone) {
      this.byId.delete(id);
      this.meta.delete(id);
    }
    const nextSelection = new Set([...this.selection].filter((id) => !gone.has(id)));
    if (nextSelection.size !== this.selection.size) this.selection = nextSelection;
    this.tabs = this.tabs.filter((t) => !(t.kind === "key" && t.key && gone.has(bytesId(t.key))));
    if (!this.tabs.some((t) => t.id === this.activeTabId)) this.activeTabId = this.tabs.at(-1)?.id ?? null;
    this.scan.matched = this.keys.length;
    this.version++;
    this.metaVersion++;
  }

  renameKey(oldKey: RBytes, newKey: RBytes): void {
    const oldId = bytesId(oldKey);
    const newId = bytesId(newKey);
    const index = this.keys.findIndex((k) => bytesId(k) === oldId);
    if (index >= 0) {
      if (this.byId.has(newId)) this.keys.splice(index, 1);
      else this.keys[index] = newKey;
    }
    this.byId.delete(oldId);
    this.byId.set(newId, newKey);
    const meta = this.meta.get(oldId);
    this.meta.delete(oldId);
    if (meta) this.meta.set(newId, meta);
    for (const tab of this.tabs) {
      if (tab.kind === "key" && tab.key && bytesId(tab.key) === oldId) {
        tab.key = newKey;
        tab.id = keyTabId(newKey);
        tab.title = labelOf(newKey);
        if (this.activeTabId === keyTabId(oldKey)) this.activeTabId = tab.id;
      }
    }
    this.version++;
    this.metaVersion++;
  }

  // ───────────── tür / TTL önbelleği ─────────────

  metaOf(id: string): KeyMeta | undefined {
    void this.metaVersion;
    return this.meta.get(id);
  }

  setMeta(id: string, meta: KeyMeta): void {
    this.meta.set(id, meta);
    this.metaVersion++;
  }

  invalidateMeta(ids: Iterable<string>): void {
    for (const id of ids) this.meta.delete(id);
    this.metaVersion++;
  }

  /** Görünen satırlar için çağrılır; eksik tür/TTL bilgisi toplanıp parça parça istenir. */
  requestMeta(ids: Iterable<string>): void {
    if (!settings.showKeyMeta) return;
    for (const id of ids) {
      if (!this.meta.has(id) && !this.metaInflight.has(id) && this.byId.has(id)) this.metaPending.add(id);
    }
    if (this.metaPending.size && !this.metaTimer) this.metaTimer = setTimeout(() => this.flushMeta(), 30);
  }

  private async flushMeta(): Promise<void> {
    this.metaTimer = undefined;
    const ids = [...this.metaPending];
    this.metaPending.clear();
    const db = this.db;
    for (let i = 0; i < ids.length; i += META_CHUNK) {
      const chunk = ids.slice(i, i + META_CHUNK).filter((id) => this.byId.has(id));
      if (!chunk.length) continue;
      chunk.forEach((id) => this.metaInflight.add(id));
      try {
        const metas = await api.keys.meta(this.connectionId, db, chunk.map((id) => this.byId.get(id)!));
        if (db !== this.db) return;
        chunk.forEach((id, index) => this.meta.set(id, metas[index]));
        this.metaVersion++;
      } catch (err) {
        this.handleError(err, false);
        return;
      } finally {
        chunk.forEach((id) => this.metaInflight.delete(id));
      }
    }
  }

  // ───────────── seçim ─────────────

  setSelection(ids: Iterable<string>, anchor: string | null = this.anchor): void {
    this.selection = new Set(ids);
    this.anchor = anchor;
    this.allMatching = false;
  }

  toggleSelected(id: string): void {
    const next = new Set(this.selection);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selection = next;
    this.anchor = id;
    this.allMatching = false;
  }

  clearSelection(): void {
    if (this.selection.size === 0 && !this.allMatching) return;
    this.selection = new Set();
    this.allMatching = false;
  }

  selectedKeys(): RBytes[] {
    return [...this.selection].map((id) => this.byId.get(id)).filter((k): k is RBytes => k !== undefined);
  }

  // ───────────── sekmeler ─────────────

  openTab(tab: Omit<Tab, "preview" | "dirty"> & { preview?: boolean }): void {
    const existing = this.tabs.find((t) => t.id === tab.id);
    if (existing) {
      if (tab.preview === false) existing.preview = false;
      if (tab.data !== undefined) existing.data = tab.data;
      this.activeTabId = existing.id;
      return;
    }
    const next: Tab = { ...tab, preview: tab.preview ?? false, dirty: false };
    const previewIndex = next.preview ? this.tabs.findIndex((t) => t.preview && !t.dirty) : -1;
    if (previewIndex >= 0) this.tabs[previewIndex] = next;
    else {
      const activeIndex = this.tabs.findIndex((t) => t.id === this.activeTabId);
      this.tabs.splice(activeIndex >= 0 ? activeIndex + 1 : this.tabs.length, 0, next);
    }
    this.activeTabId = next.id;
  }

  /** Tek tık önizleme açar; çift tık / düzenleme kalıcı yapar. */
  openKey(key: RBytes, preview = true): void {
    const meta = this.meta.get(bytesId(key));
    this.openTab({ id: keyTabId(key), kind: "key", title: labelOf(key), key, keyType: meta?.type, preview });
  }

  pinTab(id: string): void {
    const tab = this.tabs.find((t) => t.id === id);
    if (tab) tab.preview = false;
  }

  closeTab(id: string): void {
    const index = this.tabs.findIndex((t) => t.id === id);
    if (index < 0) return;
    this.tabs.splice(index, 1);
    if (this.activeTabId === id) this.activeTabId = (this.tabs[index] ?? this.tabs[index - 1])?.id ?? null;
  }

  closeTabs(predicate: (tab: Tab) => boolean): void {
    this.tabs = this.tabs.filter((t) => !predicate(t));
    if (!this.tabs.some((t) => t.id === this.activeTabId)) this.activeTabId = this.tabs.at(-1)?.id ?? null;
  }

  // ───────────── hata ─────────────

  handleError(err: unknown, notify = true): void {
    if (err instanceof ApiError) {
      connections.markLost(this.connectionId, err);
      if (err.kind === "cancelled") return;
    }
    if (notify) toastError(err);
  }
}


function waitFor(condition: () => boolean, timeoutMs: number): Promise<void> {
  if (condition()) return Promise.resolve();
  const deadline = performance.now() + timeoutMs;
  return new Promise((resolve) => {
    const tick = () => (condition() || performance.now() > deadline ? resolve() : setTimeout(tick, 16));
    tick();
  });
}

export function keyTabId(key: RBytes): string {
  return `key:${bytesId(key)}`;
}

const workspaces = new Map<string, Workspace>();

export function workspaceFor(connectionId: string): Workspace {
  let ws = workspaces.get(connectionId);
  if (!ws) {
    ws = new Workspace(connectionId);
    workspaces.set(connectionId, ws);
  }
  return ws;
}

export function dropWorkspace(connectionId: string): void {
  workspaces.get(connectionId)?.cancelScan();
  workspaces.delete(connectionId);
}
