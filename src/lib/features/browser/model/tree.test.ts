import { describe, expect, it } from "vitest";
import type { RBytes } from "$lib/api/types";
import { KeyTree, ancestorPaths, rowKey, type TreeRow } from "./tree";

function names(rows: TreeRow[]): string[] {
  return rows.map((r) => (r.kind === "folder" ? `${"  ".repeat(r.depth)}[${r.name}] ${r.count}` : `${"  ".repeat(r.depth)}${r.label.slice(r.nameStart)}`));
}

describe("KeyTree", () => {
  const keys: RBytes[] = ["user:10", "user:2", "session:a", "user:1:profile", "plain", "user:1:cart"];

  it("ayırıcıyla klasörler, sayılar ve doğal sıralama", () => {
    const tree = new KeyTree(":", false);
    tree.sync(keys, 0);
    expect(names(tree.rows(new Set()))).toEqual(["[session] 1", "[user] 4", "plain"]);
    expect(names(tree.rows(new Set(["user", "user:1"])))).toEqual([
      "[session] 1",
      "[user] 4",
      "  [1] 2",
      "    cart",
      "    profile",
      "  2",
      "  10",
      "plain",
    ]);
    expect(tree.size).toBe(6);
    expect(tree.folderCount).toBe(3);
  });

  it("liste görünümü düzdür ve tam adla sıralar", () => {
    const tree = new KeyTree(":", true);
    tree.sync(keys, 0);
    expect(tree.rows(new Set()).map((r) => (r.kind === "key" ? r.label : "?"))).toEqual(["plain", "session:a", "user:1:cart", "user:1:profile", "user:2", "user:10"]);
  });

  it("çok karakterli ayırıcı, boş parçalar, sondaki ayırıcı", () => {
    const tree = new KeyTree("::", false);
    tree.sync(["a::b::c", "a::::d", "a::", "::x"], 0);
    const rows = tree.rows(new Set(["a", "a::", "a::b", ""]));
    expect(names(rows)).toEqual(["[] 1", "  x", "[a] 3", "  [] 1", "    d", "  [b] 1", "    c", "  "]);
    expect(tree.folder("a::b")?.count).toBe(1);
  });

  it("artımlı ekler ve yalnızca yeni parçayı işler; aynı kimlik iki kez eklenmez", () => {
    const list: RBytes[] = ["a:1", "a:3"];
    const tree = new KeyTree(":", false);
    expect(tree.sync(list, 0)).toBe(true);
    expect(tree.sync(list, 0)).toBe(false);
    list.push("a:2", "b:1", "a:1");
    expect(tree.sync(list, 0)).toBe(true);
    expect(names(tree.rows(new Set(["a"])))).toEqual(["[a] 3", "  1", "  2", "  3", "[b] 1"]);
  });

  it("epoch değişince (silme, yeniden adlandırma) baştan kurar", () => {
    const list: RBytes[] = ["a:1", "a:2"];
    const tree = new KeyTree(":", false);
    tree.sync(list, 0);
    list[0] = "z:9";
    expect(tree.sync(list, 1)).toBe(true);
    expect(names(tree.rows(new Set()))).toEqual(["[a] 1", "[z] 1"]);
    expect(tree.leaf("a:1")).toBeUndefined();
    expect(tree.sync([], 2)).toBe(true);
    expect(tree.rows(new Set())).toEqual([]);
  });

  it("ikili anahtarlar \\xNN ile gösterilir, klasör ikili olarak işaretlenir", () => {
    const binary = { $b: btoa(String.fromCharCode(0x62, 0x3a, 0xff, 0x00)) }; // "b:\xff\x00"
    const tree = new KeyTree(":", false);
    tree.sync([binary, "b:text"], 0);
    const folder = tree.folder("b")!;
    expect(folder.binary).toBe(true);
    const leaf = tree.keysUnder(folder).find((k) => k.binary)!;
    expect(leaf.label).toBe("b:\\xff\\x00");
    expect(leaf.label.slice(leaf.nameStart)).toBe("\\xff\\x00");
    expect(leaf.id.startsWith("\u0000b:")).toBe(true);
  });

  it("klasör altı anahtarlar, seçim sayıları, ata yolları", () => {
    const tree = new KeyTree(":", false);
    tree.sync(keys, 0);
    const user = tree.folder("user")!;
    expect(tree.keysUnder(user).map((k) => k.id)).toEqual(["user:1:cart", "user:1:profile", "user:2", "user:10"]);
    const counts = tree.selectedPerFolder(new Set(["user:1:cart", "user:2", "plain"]));
    expect(counts.get(user)).toBe(2);
    expect(counts.get(tree.folder("user:1")!)).toBe(1);
    expect(counts.get(tree.folder("session")!)).toBeUndefined();
    expect(ancestorPaths(tree.leaf("user:1:cart")!)).toEqual(["user:1", "user"]);
    expect(rowKey(user)).toBe("f:user");
    expect(rowKey(tree.leaf("plain")!)).toBe("k:plain");
  });

  it("100k anahtar: kurulum + açık düzleştirme bütçe içinde", () => {
    const list: string[] = [];
    for (let i = 0; i < 100_000; i++) list.push(`tenant:${i % 50}:user:${i}:${i % 3 ? "profile" : "cart"}`);
    const tree = new KeyTree(":", false);
    const started = performance.now();
    // Taramadaki gibi parça parça
    const view: string[] = [];
    for (let i = 0; i < list.length; i += 5000) {
      view.push(...list.slice(i, i + 5000));
      tree.sync(view, 0);
      tree.rows(new Set(["tenant"]));
    }
    const built = performance.now() - started;
    const expanded = new Set<string>([...tree.folders()].map((f) => f.path));
    const flatStart = performance.now();
    const rows = tree.rows(expanded);
    const flattened = performance.now() - flatStart;
    expect(rows.length).toBe(100_000 + tree.folderCount);
    expect(built).toBeLessThan(1500);
    expect(flattened).toBeLessThan(400);

    const flat = new KeyTree(":", true);
    const flatStarted = performance.now();
    flat.sync(list, 0);
    expect(flat.rows(new Set()).length).toBe(100_000);
    expect(performance.now() - flatStarted).toBeLessThan(800);
  });
});
