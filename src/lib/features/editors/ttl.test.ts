import { describe, expect, it } from "vitest";
import { bestUnit, parseTtl, splitDuration } from "./ttl";

describe("parseTtl", () => {
  it("birimsiz sayı seçili birimle çarpılır", () => {
    expect(parseTtl("90")).toBe(90_000);
    expect(parseTtl("2", "h")).toBe(7_200_000);
    expect(parseTtl("1,5", "m")).toBe(90_000);
  });

  it("birimli ve bileşik girdiler", () => {
    expect(parseTtl("15m")).toBe(900_000);
    expect(parseTtl("2h30m")).toBe(9_000_000);
    expect(parseTtl("1.5h")).toBe(5_400_000);
    expect(parseTtl("1g 2sa")).toBe(93_600_000);
    expect(parseTtl("45 sn")).toBe(45_000);
    expect(parseTtl("3 GÜN")).toBe(259_200_000);
    expect(parseTtl("10 dk")).toBe(600_000);
  });

  it("geçersiz, boş ve sıfır → null", () => {
    expect(parseTtl("")).toBeNull();
    expect(parseTtl("0")).toBeNull();
    expect(parseTtl("abc")).toBeNull();
    expect(parseTtl("5x")).toBeNull();
    expect(parseTtl("-5")).toBeNull();
    expect(parseTtl("1h foo")).toBeNull();
  });
});

describe("süre yardımcıları", () => {
  it("splitDuration yukarı yuvarlar", () => {
    expect(splitDuration(93_784_001)).toEqual({ days: 1, hours: 2, minutes: 3, seconds: 5 });
    expect(splitDuration(-5)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  });

  it("bestUnit en büyük tam birimi seçer", () => {
    expect(bestUnit(7_200_000)).toEqual({ value: 2, unit: "h" });
    expect(bestUnit(86_400_000 * 3)).toEqual({ value: 3, unit: "d" });
    expect(bestUnit(90_000)).toEqual({ value: 90, unit: "s" });
    expect(bestUnit(1_500)).toEqual({ value: 2, unit: "s" });
  });
});
