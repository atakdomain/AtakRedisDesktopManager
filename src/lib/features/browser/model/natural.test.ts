import { describe, expect, it } from "vitest";
import { naturalCompare } from "./natural";

const sorted = (items: string[]) => [...items].sort((a, b) => naturalCompare(a, b));

describe("naturalCompare", () => {
  it("sayıları sayısal sıralar", () => {
    expect(sorted(["key:10", "key:2", "key:1", "key:100", "key:20"])).toEqual(["key:1", "key:2", "key:10", "key:20", "key:100"]);
  });

  it("çok parçalı sayılar ve baştaki sıfırlar", () => {
    expect(sorted(["v1.10.0", "v1.2.10", "v1.2.9", "v01.2.9"])).toEqual(["v1.2.9", "v01.2.9", "v1.2.10", "v1.10.0"]);
    expect(naturalCompare("a007", "a7")).not.toBe(0);
    expect(Math.sign(naturalCompare("a007", "a8"))).toBe(-1);
  });

  it("büyük/küçük harf ayrımsız, eşitlikte büyük harf önce", () => {
    expect(sorted(["beta", "Alpha", "alpha", "Beta"])).toEqual(["Alpha", "alpha", "Beta", "beta"]);
  });

  it("Türkçe harfler temel harfin ardından gelir", () => {
    expect(sorted(["d", "ç", "c", "z", "ş", "s", "ı", "i", "h", "ö", "o", "p", "ü", "u", "v", "ğ", "g"])).toEqual(
      ["c", "ç", "d", "g", "ğ", "h", "ı", "i", "o", "ö", "p", "s", "ş", "u", "ü", "v", "z"],
    );
    expect(sorted(["İzmir", "Istanbul", "Ankara"])).toEqual(["Ankara", "Istanbul", "İzmir"]);
  });

  it("önek daha kısa olan önce, başlangıç konumları dikkate alınır", () => {
    expect(Math.sign(naturalCompare("user", "user:1"))).toBe(-1);
    expect(naturalCompare("a:b:10", "x:y:10", 4, 4)).toBe(0);
    expect(Math.sign(naturalCompare("a:2", "zz:10", 2, 3))).toBe(-1);
  });

  it("antisimetrik ve eşitlikte sıfır", () => {
    const items = ["a1", "a01", "A1", "a10", "b", "B", "ç", "1", "01", ":", ""];
    for (const a of items) {
      for (const b of items) expect(Math.sign(naturalCompare(a, b)) + Math.sign(naturalCompare(b, a))).toBe(0);
      expect(naturalCompare(a, a)).toBe(0);
    }
  });
});
