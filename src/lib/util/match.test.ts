import { describe, expect, it } from "vitest";
import type { KeyFilter } from "$lib/api/types";
import { compileMatcher, foldCase } from "./match";

const f = (mode: KeyFilter["mode"], term: string, caseSensitive = false) => compileMatcher({ mode, term, caseSensitive });

describe("foldCase", () => {
  it("Türkçe İ/I/ı/i hepsini i'ye katlar ve uzunluğu korur", () => {
    expect(foldCase("İSTANBUL ıIiİ")).toBe("istanbul iiii");
    expect(foldCase("İstanbul").length).toBe("İstanbul".length);
  });
});

describe("compileMatcher", () => {
  it("contains duyarsız: büyük/küçük ve Türkçe harfler eşleşir", () => {
    const m = f("contains", "istanbul");
    expect(m.test("kullanıcı:İstanbul:1")).toBe(true);
    expect(m.test("KULLANICI:ISTANBUL:2")).toBe(true);
    expect(m.test("ankara")).toBe(false);
  });

  it("contains duyarlı: yalnızca birebir", () => {
    const m = f("contains", "Cache", true);
    expect(m.test("Cache:Product:1")).toBe(true);
    expect(m.test("cache:product:1")).toBe(false);
  });

  it("contains'te * ve ? joker, [ ] düz metin", () => {
    expect(f("contains", "user:*:name").test("app:user:42:name")).toBe(true);
    expect(f("contains", "a?c").test("xabcx")).toBe(true);
    expect(f("contains", "[1]").test("list[1]")).toBe(true);
    expect(f("contains", "[1]").test("list1")).toBe(false);
  });

  it("prefix ve exact", () => {
    expect(f("prefix", "user:").test("user:1")).toBe(true);
    expect(f("prefix", "user:").test("x:user:1")).toBe(false);
    expect(f("exact", "user:1").test("user:1")).toBe(true);
    expect(f("exact", "user:1").test("user:10")).toBe(false);
    expect(f("exact", "USER:1").test("user:1")).toBe(true);
    expect(f("exact", "USER:1", true).test("user:1")).toBe(false);
  });

  it("glob sınıfları ve kaçış", () => {
    expect(f("glob", "user:[0-9]*", true).test("user:7abc")).toBe(true);
    expect(f("glob", "user:[^0-9]*", true).test("user:7abc")).toBe(false);
    expect(f("glob", "a\\*b", true).test("a*b")).toBe(true);
    expect(f("glob", "a\\*b", true).test("axb")).toBe(false);
  });

  it("regex ve geçersiz regex", () => {
    expect(f("regex", "^user:\\d+$").test("USER:12")).toBe(true);
    expect(f("regex", "^user:\\d+$", true).test("USER:12")).toBe(false);
    expect(f("regex", "(").test("anything")).toBe(false);
  });

  it("vurgulama aralıkları", () => {
    expect(f("contains", "product").ranges("cache:Product:product")).toEqual([
      [6, 13],
      [14, 21],
    ]);
    expect(f("contains", "").ranges("abc")).toEqual([]);
  });
});
