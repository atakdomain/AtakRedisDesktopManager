import { describe, expect, it } from "vitest";
import { label } from "$lib/api/bytes";
import { quoteArg, readCommand } from "./command";
import { segments } from "./highlight";
import { commonFolder, parseLabel } from "./names";
import { checkState, indexOfKey, rangeIds, rangeSelection } from "./selection";
import { KeyTree } from "./tree";

describe("aralık seçimi (görünür sıra)", () => {
  const tree = new KeyTree(":", false);
  tree.sync(["a:1", "a:2", "b:1", "c", "d"], 0);
  const rows = tree.rows(new Set(["a"])); // [a] a:1 a:2 [b] c d

  it("klasör satırlarını atlar, iki yönde çalışır", () => {
    expect(rangeIds(rows, 1, 4)).toEqual(["a:1", "a:2", "c"]);
    expect(rangeIds(rows, 5, 2)).toEqual(["a:2", "c", "d"]);
    expect(indexOfKey(rows, "c")).toBe(4);
    expect(indexOfKey(rows, "b:1")).toBe(-1);
  });

  it("çapa görünmüyorsa yalnızca hedef; Ctrl+Shift mevcut seçime ekler", () => {
    expect([...rangeSelection(rows, "a:1", 5)]).toEqual(["a:1", "a:2", "c", "d"]);
    expect([...rangeSelection(rows, "b:1", 4)]).toEqual(["c"]);
    expect([...rangeSelection(rows, null, 2)]).toEqual(["a:2"]);
    expect([...rangeSelection(rows, "c", 5, new Set(["a:1"]))]).toEqual(["a:1", "c", "d"]);
  });

  it("onay kutusu durumu", () => {
    expect(checkState(0, 5)).toBe("none");
    expect(checkState(2, 5)).toBe("some");
    expect(checkState(5, 5)).toBe("all");
  });
});

describe("vurgu parçaları", () => {
  it("eşleşmeleri görünen kısma kırpar", () => {
    expect(segments("user:İstanbul:7", [[5, 13]], 5)).toEqual([
      { text: "İstanbul", hl: true, esc: false },
      { text: ":7", hl: false, esc: false },
    ]);
    expect(segments("abc", [], 0)).toEqual([{ text: "abc", hl: false, esc: false }]);
    expect(segments("abcdef", [[0, 2]], 3)).toEqual([{ text: "def", hl: false, esc: false }]);
  });

  it("ikili kaçışları ayrı işaretler", () => {
    expect(segments("k\\xff\\x00AB", [[9, 10]], 0, true)).toEqual([
      { text: "k", hl: false, esc: false },
      { text: "\\xff\\x00", hl: false, esc: true },
      { text: "A", hl: true, esc: false },
      { text: "B", hl: false, esc: false },
    ]);
  });
});

describe("komut olarak kopyala", () => {
  it("redis-cli tırnaklaması", () => {
    expect(quoteArg("user:1")).toBe("user:1");
    expect(quoteArg("kullanıcı:İstanbul")).toBe("kullanıcı:İstanbul");
    expect(quoteArg("a b")).toBe('"a b"');
    expect(quoteArg('say "hi"\n')).toBe('"say \\"hi\\"\\n"');
    expect(quoteArg("")).toBe('""');
    expect(quoteArg({ $b: btoa(String.fromCharCode(0xff, 0x00, 0x41)) })).toBe('"\\xff\\x00A"');
  });

  it("türe göre okuma komutu", () => {
    expect(readCommand("hash", "user:1")).toBe("HGETALL user:1");
    expect(readCommand("zset", "lb")).toBe("ZRANGE lb 0 -1 WITHSCORES");
    expect(readCommand("ReJSON-RL", "cfg")).toBe("JSON.GET cfg");
    expect(readCommand(undefined, "x y")).toBe('TYPE "x y"');
  });
});

describe("ad yardımcıları", () => {
  it("ikili adı geri çevirir, metin adı olduğu gibi bırakır", () => {
    const original = { $b: btoa(String.fromCharCode(0xff, 0x00, 0x41, 0x42)) };
    expect(parseLabel(label(original), true)).toEqual(original);
    expect(parseLabel("plain\\x41", false)).toBe("plain\\x41");
    expect(parseLabel("now\\x41ok", true)).toBe("nowAok");
  });

  it("ortak klasör", () => {
    expect(commonFolder(["user:1", "user:2"], ":")).toBe("user");
    expect(commonFolder(["user:a:1", "user:a:22"], ":")).toBe("user:a");
    expect(commonFolder(["user:10:x", "user:1"], ":")).toBe("user");
    expect(commonFolder(["user:1"], ":")).toBe("user");
    expect(commonFolder(["a", "b"], ":")).toBe("");
    expect(commonFolder([], ":")).toBe("");
  });
});
