// Anahtar ağacı: ayırıcıya göre klasörlenir, taramadan gelen parçalarla artımlı büyür.
// Satırlar mevcut düğüm nesnelerine başvurudur (düzleştirmede satır başına nesne üretilmez);
// sıralama yalnızca açılan klasörlerde ve yalnızca değiştiklerinde yapılır (TimSort sona eklenmiş
// sıralı-olmayan parçayı birleştirir, yani her parçada sıralama neredeyse doğrusal kalır).
import { bytesId, isBinary, label } from "$lib/api/bytes";
import type { RBytes } from "$lib/api/types";
import { naturalCompare } from "./natural";

export interface KeyNode {
  readonly kind: "key";
  /** `bytesId` — seçim ve tür/TTL önbelleği kimliği */
  readonly id: string;
  readonly key: RBytes;
  /** Görünen tam ad; ikili baytlar `\xNN` */
  readonly label: string;
  /** Ağaçta yalnızca son parça gösterilir: `label.slice(nameStart)` */
  readonly nameStart: number;
  readonly depth: number;
  readonly parent: FolderNode | null;
  readonly binary: boolean;
}

export interface FolderNode {
  readonly kind: "folder";
  /** Kimlik ve sunucu öneki: ayırıcı hariç tam yol (`user:session`) */
  readonly path: string;
  readonly name: string;
  readonly depth: number;
  readonly parent: FolderNode | null;
  /** Altındaki (iç içe dahil) yüklenmiş anahtar sayısı */
  count: number;
  /** Altında ikili anahtar var: yol sunucu desenine birebir çevrilemez */
  binary: boolean;
  folders: FolderNode[];
  keys: KeyNode[];
  /** İlk alt klasörde oluşturulur (anahtar başına klasör düşen ağaçlarda bellek tasarrufu) */
  childByName: Map<string, FolderNode> | null;
  sorted: boolean;
}

export type TreeRow = FolderNode | KeyNode;

// Boş klasör/anahtar dizileri ilk eklemeye dek paylaşılır
const NONE_FOLDERS: FolderNode[] = [];
const NONE_KEYS: KeyNode[] = [];

function newFolder(name: string, path: string, depth: number, parent: FolderNode | null): FolderNode {
  return { kind: "folder", path, name, depth, parent, count: 0, binary: false, folders: NONE_FOLDERS, keys: NONE_KEYS, childByName: null, sorted: true };
}

const byFolderName = (a: FolderNode, b: FolderNode) => naturalCompare(a.name, b.name);
const byKeyName = (a: KeyNode, b: KeyNode) => naturalCompare(a.label, b.label, a.nameStart, b.nameStart);

export class KeyTree {
  readonly separator: string;
  /** Liste görünümü: klasör yok, tüm anahtarlar kökte */
  readonly flat: boolean;
  readonly root: FolderNode;

  private source: readonly RBytes[] | null = null;
  private epoch = Number.NaN;
  private processed = 0;
  private leaves = new Map<string, KeyNode>();
  private folderByPath = new Map<string, FolderNode>();

  constructor(separator: string, flat: boolean) {
    this.separator = separator;
    this.flat = flat || separator === "";
    this.root = newFolder("", "", -1, null);
  }

  get size(): number {
    return this.root.count;
  }

  get folderCount(): number {
    return this.folderByPath.size;
  }

  /**
   * Yüklenen listeyle eşitler. Liste aynı ve `epoch` değişmediyse yalnızca yeni eklenenler işlenir;
   * aksi hâlde (yeni arama, silme, yeniden adlandırma) baştan kurulur. Değişiklik olduysa true.
   */
  sync(keys: readonly RBytes[], epoch: number): boolean {
    let changed = false;
    if (keys !== this.source || epoch !== this.epoch || keys.length < this.processed) {
      changed = this.processed > 0;
      this.reset();
      this.source = keys;
      this.epoch = epoch;
    }
    if (this.processed === keys.length) return changed;
    for (let i = this.processed; i < keys.length; i++) this.insert(keys[i]);
    this.processed = keys.length;
    return true;
  }

  private reset(): void {
    const root = this.root;
    root.count = 0;
    root.binary = false;
    root.folders = NONE_FOLDERS;
    root.keys = NONE_KEYS;
    root.childByName = null;
    root.sorted = true;
    this.leaves = new Map();
    this.folderByPath = new Map();
    this.processed = 0;
  }

  private insert(key: RBytes): void {
    const id = bytesId(key);
    if (this.leaves.has(id)) return;
    const binary = isBinary(key);
    const text = label(key);
    let parent = this.root;
    parent.count++;
    if (binary) parent.binary = true;
    let start = 0;
    if (!this.flat) {
      const sep = this.separator;
      let at = text.indexOf(sep);
      while (at !== -1) {
        const name = text.slice(start, at);
        let folder = parent.childByName?.get(name);
        if (!folder) {
          folder = newFolder(name, text.slice(0, at), parent.depth + 1, parent === this.root ? null : parent);
          (parent.childByName ??= new Map()).set(name, folder);
          if (parent.folders === NONE_FOLDERS) parent.folders = [];
          parent.folders.push(folder);
          parent.sorted = false;
          this.folderByPath.set(folder.path, folder);
        }
        folder.count++;
        if (binary) folder.binary = true;
        parent = folder;
        start = at + sep.length;
        at = text.indexOf(sep, start);
      }
    }
    const node: KeyNode = { kind: "key", id, key, label: text, nameStart: start, depth: parent.depth + 1, parent: parent === this.root ? null : parent, binary };
    if (parent.keys === NONE_KEYS) parent.keys = [];
    parent.keys.push(node);
    parent.sorted = false;
    this.leaves.set(id, node);
  }

  private ensureSorted(folder: FolderNode): void {
    if (folder.sorted) return;
    if (folder.folders.length > 1) folder.folders.sort(byFolderName);
    if (folder.keys.length > 1) folder.keys.sort(byKeyName);
    folder.sorted = true;
  }

  /** Görünen satırlar: klasörler önce, sonra anahtarlar; yalnızca açık klasörlerin içi */
  rows(expanded: ReadonlySet<string>): TreeRow[] {
    const out: TreeRow[] = [];
    const visit = (folder: FolderNode) => {
      this.ensureSorted(folder);
      for (const child of folder.folders) {
        out.push(child);
        if (expanded.has(child.path)) visit(child);
      }
      for (const key of folder.keys) out.push(key);
    };
    visit(this.root);
    return out;
  }

  leaf(id: string): KeyNode | undefined {
    return this.leaves.get(id);
  }

  folder(path: string): FolderNode | undefined {
    return this.folderByPath.get(path);
  }

  folders(): IterableIterator<FolderNode> {
    return this.folderByPath.values();
  }

  /** Klasörün altındaki tüm yüklenmiş anahtarlar (görünür sırayla) */
  keysUnder(folder: FolderNode): KeyNode[] {
    const out: KeyNode[] = [];
    const visit = (f: FolderNode) => {
      this.ensureSorted(f);
      for (const child of f.folders) visit(child);
      for (const key of f.keys) out.push(key);
    };
    visit(folder);
    return out;
  }

  /** Seçili anahtarların klasör başına sayısı (onay kutusu: tümü / bir kısmı / hiçbiri) */
  selectedPerFolder(selection: ReadonlySet<string>): Map<FolderNode, number> {
    const counts = new Map<FolderNode, number>();
    if (this.flat || selection.size === 0) return counts;
    for (const id of selection) {
      let folder = this.leaves.get(id)?.parent ?? null;
      while (folder) {
        counts.set(folder, (counts.get(folder) ?? 0) + 1);
        folder = folder.parent;
      }
    }
    return counts;
  }
}

/** Satır kimliği (imleç): klasör ve anahtar ad alanları çakışmasın */
export function rowKey(row: TreeRow): string {
  return row.kind === "folder" ? `f:${row.path}` : `k:${row.id}`;
}

/** Klasörün ve tüm üst klasörlerinin yolları (ör. bir anahtarı görünür kılmak için) */
export function ancestorPaths(node: TreeRow): string[] {
  const out: string[] = [];
  let folder = node.parent;
  while (folder) {
    out.push(folder.path);
    folder = folder.parent;
  }
  return out;
}
