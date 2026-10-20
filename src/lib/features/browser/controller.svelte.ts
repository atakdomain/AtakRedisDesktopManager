// Anahtar gezgininin görünüm durumu: ağaç/liste satırları, imleç, seçim ve klavye davranışı.
// Bağlantı başına bir tane (önbellekli): bağlantılar arasında geçince açık klasörler ve imleç korunur.
import { bytesId } from "$lib/api/bytes";
import { isMac } from "$lib/state/commands.svelte";
import { settings } from "$lib/state/settings.svelte";
import type { KeyFilter } from "$lib/api/types";
import type { Workspace } from "$lib/state/workspace.svelte";
import { compileMatcher, type Matcher } from "$lib/util/match";
import { checkState, rangeSelection } from "./model/selection";
import { KeyTree, rowKey, type FolderNode, type KeyNode, type TreeRow } from "./model/tree";

/** Arama sonucu bu kadar anahtara kadar klasörler kendiliğinden açılır */
const AUTO_EXPAND_LIMIT = 1000;
const PREVIEW_DELAY = 120;
const NO_COUNTS = new Map<FolderNode, number>();

export interface ListHandle {
  scrollToIndex(index: number, align?: "auto" | "start" | "center"): void;
  focus(): void;
}

/** Klavyeyle tetiklenen, gezgin dışında tanımlı eylemler */
export interface RowActions {
  remove(): void;
  rename(key: KeyNode): void;
  copyNames(): void;
}

export class BrowserController {
  readonly ws: Workspace;
  /** İmleçteki satırın kimliği (`rowKey`) */
  cursor = $state<string | null>(null);
  /** Görünen satır aralığı [start, end) */
  range = $state.raw<[number, number]>([0, 0]);
  list: ListHandle | null = null;
  actions: RowActions | null = null;

  private tree: KeyTree | null = null;
  private previewTimer: ReturnType<typeof setTimeout> | undefined;
  private autoEpoch = -1;
  private autoSeen = new Set<string>();

  constructor(ws: Workspace) {
    this.ws = ws;
  }

  readonly rows: TreeRow[] = $derived.by(() => {
    const keys = this.ws.keyList;
    const epoch = this.ws.keyListEpoch;
    const sep = this.ws.separator;
    const flat = !settings.treeView || sep === "";
    let tree = this.tree;
    if (!tree || tree.flat !== flat || tree.separator !== sep) tree = this.tree = new KeyTree(sep, flat);
    tree.sync(keys, epoch);
    return tree.rows(this.ws.expanded);
  });

  get model(): KeyTree {
    void this.rows;
    return this.tree!;
  }

  readonly matcher: Matcher = $derived.by(() => compileMatcher(this.ws.filter));

  readonly folderSelection: Map<FolderNode, number> = $derived.by(() => {
    if (this.ws.selection.size === 0) return NO_COUNTS;
    return this.model.selectedPerFolder(this.ws.selection);
  });

  /** Etkin sekmede açık anahtarın kimliği (satırda işaretlenir) */
  readonly activeKeyId: string | null = $derived.by(() => {
    const tab = this.ws.activeTab;
    return tab?.kind === "key" && tab.key ? bytesId(tab.key) : null;
  });

  // ───────────── satır durumu ─────────────

  isSelected(row: TreeRow): boolean {
    return row.kind === "key" ? this.ws.selection.has(row.id) : this.folderCheck(row) === "all";
  }

  folderCheck(folder: FolderNode): "all" | "some" | "none" {
    if (this.ws.allMatching) return "all";
    return checkState(this.folderSelection.get(folder) ?? 0, folder.count);
  }

  isExpanded(folder: FolderNode): boolean {
    return this.ws.expanded.has(folder.path);
  }

  cursorIndex(): number {
    const cursor = this.cursor;
    if (!cursor) return -1;
    const folder = cursor.startsWith("f:");
    const id = cursor.slice(2);
    const rows = this.rows;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (folder ? row.kind === "folder" && row.path === id : row.kind === "key" && row.id === id) return i;
    }
    return -1;
  }

  // ───────────── arama ─────────────

  /** Süzgeci uygular; `search` false ise yalnızca görünüm (boş metinde mod/Aa değişimi sonucu etkilemez) */
  setFilter(next: KeyFilter, search: boolean): void {
    const filter = this.ws.filter;
    filter.mode = next.mode;
    filter.term = next.term;
    filter.caseSensitive = next.caseSensitive;
    filter.types = [...next.types];
    if (search) void this.ws.search();
  }

  // ───────────── klasörler ─────────────

  toggleFolder(folder: FolderNode, open = !this.isExpanded(folder)): void {
    const next = new Set(this.ws.expanded);
    if (open) next.add(folder.path);
    else next.delete(folder.path);
    this.ws.expanded = next;
  }

  expandAll(): void {
    this.ws.expanded = new Set(Array.from(this.model.folders(), (f) => f.path));
  }

  collapseAll(): void {
    this.ws.expanded = new Set();
  }

  expandBelow(folder: FolderNode): void {
    const next = new Set(this.ws.expanded);
    const visit = (f: FolderNode) => {
      next.add(f.path);
      f.folders.forEach(visit);
    };
    visit(folder);
    this.ws.expanded = next;
  }

  /** Aramada az sonuç varsa klasörleri açar ki eşleşmeler görünsün; kullanıcının kapattığına bir daha dokunmaz */
  autoExpand(): void {
    const ws = this.ws;
    const tree = this.model;
    if (!ws.filter.term || tree.flat || tree.size === 0 || tree.size > AUTO_EXPAND_LIMIT) return;
    if (ws.keyListEpoch !== this.autoEpoch) {
      this.autoEpoch = ws.keyListEpoch;
      this.autoSeen = new Set();
    }
    let next: Set<string> | null = null;
    for (const folder of tree.folders()) {
      if (this.autoSeen.has(folder.path)) continue;
      this.autoSeen.add(folder.path);
      if (!ws.expanded.has(folder.path)) (next ??= new Set(ws.expanded)).add(folder.path);
    }
    if (next) ws.expanded = next;
  }

  // ───────────── seçim ─────────────

  selectAll(): void {
    const ids = this.ws.keyList.map(bytesId);
    this.ws.setSelection(ids, this.ws.anchor);
  }

  selectFolder(folder: FolderNode, on = this.folderCheck(folder) !== "all"): void {
    const next = new Set(this.ws.allMatching ? [] : this.ws.selection);
    for (const key of this.model.keysUnder(folder)) {
      if (on) next.add(key.id);
      else next.delete(key.id);
    }
    this.ws.setSelection(next, this.ws.anchor);
  }

  /** Bağlam menüsü: seçimin dışındaki satıra sağ tıklanınca seçim o satır olur */
  ensureSelected(row: KeyNode): void {
    if (!this.ws.selection.has(row.id)) this.ws.setSelection([row.id], row.id);
    this.cursor = rowKey(row);
  }

  // ───────────── fare ─────────────

  click(row: TreeRow, index: number, e: MouseEvent): void {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    this.cursor = rowKey(row);
    if (row.kind === "folder") {
      if (mod) this.selectFolder(row);
      else this.toggleFolder(row);
      return;
    }
    if (e.shiftKey) {
      this.ws.selection = rangeSelection(this.rows, this.ws.anchor, index, mod ? this.ws.selection : undefined);
      this.ws.allMatching = false;
      return;
    }
    if (mod) {
      this.ws.toggleSelected(row.id);
      return;
    }
    this.ws.setSelection([row.id], row.id);
    clearTimeout(this.previewTimer);
    this.ws.openKey(row.key, true);
  }

  dblclick(row: TreeRow): void {
    if (row.kind === "key") this.ws.openKey(row.key, false);
  }

  /** Onay kutusu: Ctrl+tık gibi ekler/çıkarır; Shift ile aralık ekler */
  check(row: TreeRow, index: number, e: MouseEvent): void {
    e.stopPropagation();
    this.cursor = rowKey(row);
    if (row.kind === "folder") {
      this.selectFolder(row);
      return;
    }
    if (e.shiftKey) {
      this.ws.selection = rangeSelection(this.rows, this.ws.anchor, index, this.ws.selection);
      this.ws.allMatching = false;
      return;
    }
    this.ws.toggleSelected(row.id);
  }

  // ───────────── klavye ─────────────

  /**
   * İmleci taşır. `extend` (Shift): çapadan aralık seçer; `cursorOnly` (Ctrl): seçime dokunmaz;
   * ikisi de yoksa seçim imlecin anahtarı olur ve kısa bir gecikmeyle önizlenir.
   */
  moveTo(target: number, { extend = false, cursorOnly = false } = {}): void {
    const rows = this.rows;
    if (rows.length === 0) return;
    const index = Math.max(0, Math.min(rows.length - 1, target));
    const row = rows[index];
    this.cursor = rowKey(row);
    this.list?.scrollToIndex(index);
    if (extend) {
      if (row.kind === "key" && this.ws.anchor === null) this.ws.anchor = row.id;
      this.ws.selection = rangeSelection(rows, this.ws.anchor, index);
      this.ws.allMatching = false;
      return;
    }
    if (cursorOnly) return;
    if (row.kind === "folder") {
      this.ws.setSelection([], null);
      return;
    }
    this.ws.setSelection([row.id], row.id);
    // Basılı tutup gezerken her satırda editör yüklenmesin
    clearTimeout(this.previewTimer);
    const key = row.key;
    this.previewTimer = setTimeout(() => this.ws.openKey(key, true), PREVIEW_DELAY);
  }

  keydown(e: KeyboardEvent): void {
    const rows = this.rows;
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const index = this.cursorIndex();
    const row = index >= 0 ? rows[index] : undefined;
    const page = Math.max(1, this.range[1] - this.range[0] - 1);
    const how = { extend: e.shiftKey, cursorOnly: mod };
    switch (e.key) {
      case "ArrowDown":
        this.moveTo(index < 0 ? 0 : index + 1, how);
        break;
      case "ArrowUp":
        this.moveTo(index < 0 ? 0 : index - 1, how);
        break;
      case "PageDown":
        this.moveTo(index + page, how);
        break;
      case "PageUp":
        this.moveTo(index - page, how);
        break;
      case "Home":
        this.moveTo(0, how);
        break;
      case "End":
        this.moveTo(rows.length - 1, how);
        break;
      case "ArrowRight":
        if (row?.kind !== "folder") return;
        if (!this.isExpanded(row)) this.toggleFolder(row, true);
        else if (rows[index + 1]) this.moveTo(index + 1, how);
        break;
      case "ArrowLeft": {
        if (!row) return;
        if (row.kind === "folder" && this.isExpanded(row)) {
          this.toggleFolder(row, false);
          break;
        }
        const parent = row.parent;
        if (!parent) return;
        const target = rows.indexOf(parent);
        if (target >= 0) this.moveTo(target);
        break;
      }
      case "Enter":
        if (!row) return;
        if (row.kind === "folder") this.toggleFolder(row);
        else {
          clearTimeout(this.previewTimer);
          this.ws.openKey(row.key, false);
        }
        break;
      case " ":
        if (!row) return;
        if (row.kind === "folder") this.selectFolder(row);
        else this.ws.toggleSelected(row.id);
        break;
      case "Escape":
        if (this.ws.selection.size === 0 && !this.ws.allMatching) return;
        this.ws.clearSelection();
        break;
      case "Delete":
        if (!this.ensureTarget(row)) return;
        this.actions?.remove();
        break;
      case "Backspace":
        if (!(isMac && e.metaKey) || !this.ensureTarget(row)) return;
        this.actions?.remove();
        break;
      case "F2":
        if (row?.kind !== "key") return;
        this.actions?.rename(row);
        break;
      default:
        if (mod && e.key.toLowerCase() === "a" && !e.shiftKey) {
          this.selectAll();
          break;
        }
        if (mod && e.key.toLowerCase() === "c" && !e.shiftKey) {
          if (!this.ensureTarget(row)) return;
          this.actions?.copyNames();
          break;
        }
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  /** Seçim yoksa imleçteki anahtarı seçer; işlem yapılacak bir şey varsa true */
  private ensureTarget(row: TreeRow | undefined): boolean {
    if (this.ws.selection.size > 0 || this.ws.allMatching) return true;
    if (row?.kind !== "key") return false;
    this.ws.setSelection([row.id], row.id);
    return true;
  }

  dispose(): void {
    clearTimeout(this.previewTimer);
  }
}

const controllers = new WeakMap<Workspace, BrowserController>();

export function controllerFor(ws: Workspace): BrowserController {
  let ctl = controllers.get(ws);
  if (!ctl) {
    // Bileşenden bağımsız kök: türetilmiş değerler gezgin yeniden kurulunca da canlı kalır
    $effect.root(() => {
      ctl = new BrowserController(ws);
    });
    controllers.set(ws, ctl!);
  }
  return ctl!;
}
