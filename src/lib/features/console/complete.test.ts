import { describe, expect, it } from "vitest";
import { COMMANDS, lookupCommand } from "./commands";
import { acceptCommand, argHint, commandQuery, ghostText, rankCommands, syntaxGroups } from "./complete";
import { tokenize } from "./parse";

const names = (q: string, n = 5) => rankCommands(q, n).map((c) => c.name);

describe("katalog", () => {
  it("yaklaşık 200+ komut, adlar tekil ve büyük harf", () => {
    expect(COMMANDS.length).toBeGreaterThanOrEqual(200);
    expect(new Set(COMMANDS.map((c) => c.name)).size).toBe(COMMANDS.length);
    for (const c of COMMANDS) expect(c.name).toBe(c.name.toUpperCase());
  });

  it("alt komutlar iki kelimeyle bulunur", () => {
    expect(lookupCommand(tokenize("config get maxmemory").tokens)).toMatchObject({ spec: { name: "CONFIG GET" }, words: 2 });
    expect(lookupCommand(tokenize("get foo").tokens)).toMatchObject({ spec: { name: "GET" }, words: 1 });
    expect(lookupCommand(tokenize("nope").tokens)).toBeNull();
  });
});

describe("rankCommands", () => {
  it("tam eşleşme önce", () => {
    expect(names("get")[0]).toBe("GET");
    expect(names("set")[0]).toBe("SET");
  });

  it("önek eşleşmelerinde yaygın komutlar öne çıkar", () => {
    const top = names("hg", 3);
    expect(top).toContain("HGET");
    expect(top).toContain("HGETALL");
    expect(top.indexOf("HGET")).toBeLessThan(top.indexOf("HGETALL"));
  });

  it("alt komutlar", () => {
    expect(names("config ")).toEqual(expect.arrayContaining(["CONFIG GET", "CONFIG SET"]));
    expect(names("config g")[0]).toBe("CONFIG GET");
    expect(names("client l")[0]).toBe("CLIENT LIST");
  });

  it("önek > içerir > sıralı harfler", () => {
    expect(names("range", 10)).toContain("GETRANGE");
    expect(names("hgtall")[0]).toBe("HGETALL");
    expect(names("zzzz")).toEqual([]);
  });
});

describe("commandQuery", () => {
  it("komut adındayken sorgu döner", () => {
    expect(commandQuery("hge")).toBe("hge");
    expect(commandQuery("config ")).toBe("config ");
    expect(commandQuery("config g")).toBe("config g");
    expect(commandQuery("get ")).toBeNull();
    expect(commandQuery("get foo")).toBeNull();
  });
});

describe("argHint / ghostText (redis-cli ipucu)", () => {
  it("yazılan zorunlu argümanlar düşer, isteğe bağlıda durur", () => {
    expect(argHint("SET ")?.remaining).toBe("key value [NX | XX] [GET] [EX seconds | PX milliseconds | EXAT unix-time-seconds | PXAT unix-time-milliseconds | KEEPTTL]");
    expect(argHint("SET foo bar ")?.remaining).toMatch(/^\[NX \| XX\]/);
    expect(argHint("DEL a b c ")?.remaining).toBe("[key ...]");
    expect(argHint("LINSERT k ")?.remaining).toBe("<BEFORE | AFTER> pivot element");
  });

  it("syntaxGroups köşeli/açılı parantezleri bölmez", () => {
    expect(syntaxGroups("key <BEFORE | AFTER> [COUNT count]")).toEqual(["key", "<BEFORE | AFTER>", "[COUNT count]"]);
  });

  it("ghost: ad tamamlama + argümanlar, küçük harf korunur", () => {
    const top = rankCommands("hgetal", 1)[0];
    expect(ghostText("hgetal", top)).toBe("l key");
    expect(ghostText("GET", rankCommands("GET", 1)[0])).toBe(" key");
    expect(ghostText("get foo", undefined)).toBe("");
    expect(ghostText("SET foo", undefined)).toBe(" value [NX | XX] [GET] [EX seconds | PX milliseconds | EXAT unix-time-seconds | PXAT unix-time-milliseconds | KEEPTTL]");
  });

  it("acceptCommand", () => {
    const spec = rankCommands("hge", 1)[0];
    expect(acceptCommand("hge", spec)).toBe(`${spec.name.toLowerCase()} `);
    expect(acceptCommand("CONFIG G", rankCommands("CONFIG G", 1)[0])).toBe("CONFIG GET ");
  });
});
