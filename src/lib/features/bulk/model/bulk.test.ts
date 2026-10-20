import { describe, expect, it } from "vitest";
import { compileMatcher } from "$lib/util/match";
import { buildAction, isDestructive, newDraft, ttlMs, writesSource } from "./draft";
import { escapeGlob, folderFilter, prefixRename, regexError } from "./patterns";
import { nameDiff, noteCounts, progressStats } from "./preview";

describe("klasör süzgeci", () => {
  it("glob kaçışlı, duyarlı ve yalnızca klasörün altını kapsar", () => {
    const filter = folderFilter("cache:pro*[1]", ":");
    expect(filter).toEqual({ mode: "glob", term: "cache:pro\\*\\[1\\]:*", caseSensitive: true, types: [] });
    const m = compileMatcher(filter);
    expect(m.test("cache:pro*[1]:x")).toBe(true);
    expect(m.test("cache:product:x")).toBe(false);
    expect(m.test("Cache:pro*[1]:x")).toBe(false);
    expect(m.test("cache:pro*[1]")).toBe(false);
    expect(escapeGlob("a\\b?")).toBe("a\\\\b\\?");
  });
});

describe("önek değiştirme", () => {
  it("regex ve şablon karakterlerini kaçışlar", () => {
    const r = prefixRename("a.b$:", "x$1:");
    expect(r).toEqual({ find: "^a\\.b\\$:", replace: "x$$1:", regex: true, caseSensitive: true });
    // JS'nin replace'i de `$$`'ı `$` yapar — arka uçtaki Rust şablonuyla aynı anlam
    expect("a.b$:k".replace(new RegExp(r.find), r.replace)).toBe("x$1:k");
    expect("za.b$:k".replace(new RegExp(r.find), r.replace)).toBe("za.b$:k");
  });

  it("regex doğrulaması (Rust adlandırılmış grubu dahil)", () => {
    expect(regexError("^user:(\\d+)$")).toBeNull();
    expect(regexError("(?P<id>\\d+)")).toBeNull();
    expect(regexError("(")).not.toBeNull();
  });
});

describe("taslak → işlem", () => {
  const ctx = { connectionId: "c1", db: 0, now: Date.UTC(2026, 0, 1) };

  it("TTL: göreli, kaldır, tarih", () => {
    expect(ttlMs({ ttlMode: "relative", ttlAmount: 90, ttlUnit: "m", ttlAt: "" }, 0)).toBe(5_400_000);
    expect(ttlMs({ ttlMode: "relative", ttlAmount: 0, ttlUnit: "s", ttlAt: "" }, 0)).toBe("ttlAmount");
    expect(ttlMs({ ttlMode: "persist", ttlAmount: 0, ttlUnit: "s", ttlAt: "" }, 0)).toBe(0);
    expect(ttlMs({ ttlMode: "absolute", ttlAmount: 0, ttlUnit: "s", ttlAt: "" }, 0)).toBe("ttlDate");
    const past = ttlMs({ ttlMode: "absolute", ttlAmount: 0, ttlUnit: "s", ttlAt: "2020-01-01T00:00" }, ctx.now);
    expect(past).toBe("ttlPast");
    const action = buildAction(newDraft("expire", { ttlMode: "persist", onlyWithoutTtl: true }), ctx);
    expect(action).toEqual({ ok: true, action: { kind: "expire", ttlMs: 0, onlyWithoutTtl: false } });
  });

  it("yeniden adlandırma: önek ön ayarı ve bul/değiştir", () => {
    expect(buildAction(newDraft("rename", { renameMode: "prefix", oldPrefix: "user:", newPrefix: "member:" }), ctx)).toEqual({
      ok: true,
      action: { kind: "rename", find: "^user:", replace: "member:", regex: true, caseSensitive: true, overwrite: false },
    });
    expect(buildAction(newDraft("rename", { renameMode: "prefix", oldPrefix: "a:", newPrefix: "a:" }), ctx)).toEqual({ ok: false, error: "prefixSame" });
    expect(buildAction(newDraft("rename"), ctx)).toEqual({ ok: false, error: "findEmpty" });
    const bad = buildAction(newDraft("rename", { find: "(", regex: true }), ctx);
    expect(bad.ok === false && bad.error).toBe("regexInvalid");
  });

  it("kopyala: aynı hedef reddedilir, aynı bağlantı boş kimlikle gider", () => {
    expect(buildAction(newDraft("copy"), ctx)).toEqual({ ok: false, error: "copySame" });
    expect(buildAction(newDraft("copy", { targetDb: 3, moveKeys: true }), ctx)).toEqual({
      ok: true,
      action: { kind: "copy", targetConnectionId: "", targetDb: 3, replace: false, moveKeys: true },
    });
    expect(buildAction(newDraft("copy", { targetConnectionId: "c2" }), ctx)).toMatchObject({ ok: true, action: { targetConnectionId: "c2", targetDb: 0 } });
  });

  it("dışa aktarma önizlemesi yer tutucu yol kullanır", () => {
    expect(buildAction(newDraft("export"), { ...ctx, previewPath: "preview.jsonl" })).toEqual({ ok: true, action: { kind: "export", path: "preview.jsonl", format: "dump" } });
  });

  it("yazma ve yıkıcılık sınıflandırması", () => {
    expect(writesSource({ kind: "export", path: "x", format: "json" })).toBe(false);
    expect(writesSource({ kind: "copy", targetConnectionId: "", targetDb: 1, replace: true, moveKeys: false })).toBe(false);
    expect(isDestructive({ kind: "copy", targetConnectionId: "", targetDb: 1, replace: true, moveKeys: false })).toBe(true);
    expect(isDestructive({ kind: "expire", ttlMs: 0, onlyWithoutTtl: false })).toBe(false);
    expect(isDestructive({ kind: "delete" })).toBe(true);
  });
});

describe("önizleme yardımcıları", () => {
  it("not sayıları", () => {
    const counts = noteCounts([
      { key: "a", newKey: "b", note: "" },
      { key: "c", newKey: "b", note: "duplicate" },
      { key: "d", newKey: null, note: "unchanged" },
      { key: "e", newKey: "f", note: "exists" },
      { key: "g", newKey: "h", note: "" },
    ]);
    expect(counts).toMatchObject({ "": 2, duplicate: 1, unchanged: 1, exists: 1, binary: 0 });
  });

  it("ad farkı", () => {
    expect(nameDiff("user:1:profile", "member:1:profile")).toEqual({ prefix: "", removed: "user", added: "member", suffix: ":1:profile" });
    expect(nameDiff("cache:a", "cache:a:v2")).toEqual({ prefix: "cache:a", removed: "", added: ":v2", suffix: "" });
    expect(nameDiff("aaa", "aa")).toEqual({ prefix: "", removed: "aaa", added: "aa", suffix: "" });
    expect(nameDiff("user:7", "user:8")).toEqual({ prefix: "user:", removed: "7", added: "8", suffix: "" });
    expect(nameDiff("x", "x")).toEqual({ prefix: "x", removed: "", added: "", suffix: "" });
  });

  it("hız ve kalan süre", () => {
    expect(progressStats({ processed: 500, total: 1000 }, 1000)).toEqual({ ratio: 0.5, rate: 500, etaMs: 1000 });
    expect(progressStats({ processed: 10, total: null }, 1000)).toEqual({ ratio: null, rate: 10, etaMs: null });
    expect(progressStats({ processed: 0, total: 0 }, 0)).toEqual({ ratio: 1, rate: 0, etaMs: null });
    expect(progressStats({ processed: 1, total: 100 }, 100).etaMs).toBeNull();
  });
});

describe("dışa aktarma dosya adı", () => {
  it("bağlantı adından güvenli ad, db ve zaman damgası", async () => {
    const { exportFileName } = await import("../files");
    const at = new Date(2026, 9, 20, 16, 5);
    expect(exportFileName("Canlı önbellek", 0, "dump", at)).toBe("canli-onbellek-db0-20261020-1605.jsonl");
    expect(exportFileName("İzmir / Şube #2", 3, "json", at)).toBe("izmir-sube-2-db3-20261020-1605.json");
    expect(exportFileName("***", 1, "dump", at)).toBe("redis-db1-20261020-1605.jsonl");
  });
});
