import { describe, expect, it } from "vitest";
import { parseMonitorLine } from "./pubsub.svelte";
import { hexDump, jsonTokens, prettyJson } from "./payload";

describe("prettyJson", () => {
  it("nesne ve dizileri biçimlendirir, düz metni reddeder", () => {
    expect(prettyJson('{"a":1,"b":[true,null]}')).toBe('{\n  "a": 1,\n  "b": [\n    true,\n    null\n  ]\n}');
    expect(prettyJson("hello")).toBeNull();
    expect(prettyJson("42")).toBeNull();
    expect(prettyJson("{bozuk")).toBeNull();
  });
});

describe("jsonTokens", () => {
  it("birleşimi girdiyle aynı, anahtar/metin/sayı ayrımı", () => {
    const pretty = prettyJson('{"name":"x","n":-1.5e3,"ok":false}')!;
    const toks = jsonTokens(pretty);
    expect(toks.map((x) => x.s).join("")).toBe(pretty);
    expect(toks.filter((x) => x.k === "key").map((x) => x.s)).toEqual(['"name"', '"n"', '"ok"']);
    expect(toks.find((x) => x.k === "str")?.s).toBe('"x"');
    expect(toks.find((x) => x.k === "num")?.s).toBe("-1500");
    expect(jsonTokens("[-2.5e-3]").find((x) => x.k === "num")?.s).toBe("-2.5e-3");
    expect(toks.find((x) => x.k === "lit")?.s).toBe("false");
  });
});

describe("hexDump", () => {
  it("ofset, hex ve ascii sütunları", () => {
    const dump = hexDump(new TextEncoder().encode("Hello\x00"));
    expect(dump.startsWith("00000000  48 65 6c 6c 6f 00")).toBe(true);
    expect(dump.endsWith("|Hello.|")).toBe(true);
  });
});

describe("parseMonitorLine", () => {
  it("zaman, db, istemci ve komut", () => {
    expect(parseMonitorLine('1339518083.107412 [0 127.0.0.1:60866] "keys" "*"')).toEqual({ at: 1339518083107, db: 0, client: "127.0.0.1:60866", command: '"keys" "*"' });
    expect(parseMonitorLine('1339518083.1 [3 lua] "get" "x"')?.client).toBe("lua");
    expect(parseMonitorLine("OK")).toBeNull();
  });
});
