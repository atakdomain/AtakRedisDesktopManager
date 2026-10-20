import { describe, expect, it } from "vitest";
import type { RValue } from "$lib/api/types";
import { formatRaw, formatReply, isRawCommand, linesText, repr } from "./format";

const text = (v: RValue) => linesText(formatReply(v));
const s = (v: string): RValue => ({ t: "str", v });

describe("formatReply — redis-cli TTY biçimi", () => {
  it("tekil değerler", () => {
    expect(text(s("bar"))).toBe('"bar"');
    expect(text({ t: "int", v: 5 })).toBe("(integer) 5");
    expect(text({ t: "nil" })).toBe("(nil)");
    expect(text({ t: "status", v: "OK" })).toBe("OK");
    expect(text({ t: "err", v: "ERR unknown command 'FOO'" })).toBe("(error) ERR unknown command 'FOO'");
    expect(text({ t: "dbl", v: 3.14 })).toBe("(double) 3.14");
    expect(text({ t: "dbl", v: Infinity })).toBe("(double) inf");
    expect(text({ t: "bool", v: true })).toBe("(true)");
    expect(text({ t: "big", v: "1234567999999999999999" })).toBe("(big number) 1234567999999999999999");
  });

  it("boş toplamlar", () => {
    expect(text({ t: "arr", v: [] })).toBe("(empty array)");
    expect(text({ t: "map", v: [] })).toBe("(empty hash)");
    expect(text({ t: "set", v: [] })).toBe("(empty set)");
  });

  it("numaralı dizi", () => {
    expect(text({ t: "arr", v: [s("a"), s("b"), { t: "int", v: 3 }] })).toBe('1) "a"\n2) "b"\n3) (integer) 3');
  });

  it("10+ öğede sıra numarası sağa yaslanır", () => {
    const v: RValue = { t: "arr", v: Array.from({ length: 10 }, (_, i) => s(`k${i}`)) };
    const lines = text(v).split("\n");
    expect(lines[0]).toBe(' 1) "k0"');
    expect(lines[9]).toBe('10) "k9"');
  });

  it("iç içe diziler doğru girintilenir (XRANGE)", () => {
    const v: RValue = {
      t: "arr",
      v: [
        { t: "arr", v: [s("1-0"), { t: "arr", v: [s("f"), s("v")] }] },
        { t: "arr", v: [s("2-0"), { t: "arr", v: [] }] },
      ],
    };
    expect(text(v)).toBe(['1) 1) "1-0"', '   2) 1) "f"', '      2) "v"', '2) 1) "2-0"', "   2) (empty array)"].join("\n"));
  });

  it("map (RESP3) ve set", () => {
    const v: RValue = {
      t: "map",
      v: [
        [s("name"), s("redis")],
        [s("modules"), { t: "arr", v: [s("json"), s("search")] }],
      ],
    };
    expect(text(v)).toBe(['1# "name" => "redis"', '2# "modules" => 1) "json"', '   2) "search"'].join("\n"));
    expect(text({ t: "set", v: [s("x"), s("y")] })).toBe('1~ "x"\n2~ "y"');
  });

  it("dizi içinde hata ve nil", () => {
    expect(text({ t: "arr", v: [{ t: "status", v: "OK" }, { t: "err", v: "WRONGTYPE x" }, { t: "nil" }] })).toBe("1) OK\n2) (error) WRONGTYPE x\n3) (nil)");
  });

  it("verbatim çok satırlı metin", () => {
    expect(text({ t: "verbatim", v: "# Server\r\nredis_version:7.2.4\r\n" })).toBe("# Server\nredis_version:7.2.4");
  });
});

describe("ham çıktı (INFO, CLIENT LIST …)", () => {
  it("hangi komutlar ham basılır", () => {
    expect(isRawCommand(["INFO"])).toBe(true);
    expect(isRawCommand(["info", "memory"])).toBe(true);
    expect(isRawCommand(["CLIENT", "LIST"])).toBe(true);
    expect(isRawCommand(["cluster", "nodes"])).toBe(true);
    expect(isRawCommand(["cluster", "nodes", "x"])).toBe(false);
    expect(isRawCommand(["GET", "info"])).toBe(false);
  });

  it("metin tırnaksız, CRLF satırlara bölünür; diziler satır satır", () => {
    expect(linesText(formatRaw(s("# Server\r\nredis_version:7.2.4\r\n")))).toBe("# Server\nredis_version:7.2.4");
    expect(linesText(formatRaw({ t: "arr", v: [s("a"), { t: "int", v: 2 }] }))).toBe("a\n2");
    expect(formatRaw({ t: "err", v: "ERR x" })[0].segs[0]).toEqual({ k: "err", s: "(error) ERR x" });
  });
});

describe("repr", () => {
  it("kaçışlar redis-cli gibi", () => {
    expect(repr('a"b\\c\n\r\t\x07\b')).toBe('"a\\"b\\\\c\\n\\r\\t\\a\\b"');
    expect(repr("x\x01\x7f")).toBe('"x\\x01\\x7f"');
  });

  it("UTF-8 harfler okunur kalır", () => {
    expect(repr("İstanbul ğüş")).toBe('"İstanbul ğüş"');
  });

  it("ikili değer bayt bayt \\xNN", () => {
    const bin = { $b: btoa(String.fromCharCode(0xff, 0x00, 0x41, 0x22)) };
    expect(repr(bin)).toBe('"\\xff\\x00A\\""');
  });
});
