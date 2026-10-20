import { decode as mpDecode, encode as mpEncode } from "@msgpack/msgpack";
import { describe, expect, it } from "vitest";
import { decodeBase64, encodeBase64 } from "./base64";
import { escapeBytes, unescapeText, utf8 } from "./escape";
import { decodeValue, detectFormat, encodeValue, FormatError, type Codec } from "./formats";
import { hexdump, parseHex, toHexLines, HexError, asciiOfHexLine } from "./hex";
import { checkJson, formatJson, minifyJson, parseJson, writeJson, JsonSyntaxError } from "./json";
import { jsonToMsgpack, looksLikeMsgpack, msgpackToJson } from "./msgpack";
import { jsonToPhp, phpToJson } from "./php";

const bytes = (...values: number[]) => Uint8Array.from(values);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

// Gerçek sıkıştırma: platformun CompressionStream API'si (brotli yok; arka uçta Rust testi kapsar)
const STREAM_FORMAT = { gzip: "gzip", deflate: "deflate-raw", zlib: "deflate" } as const;

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const body = new Blob([data as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(body).arrayBuffer());
}

const nodeCodec: Codec = {
  async decode(data, format) {
    if (format === "brotli") throw new Error("brotli unsupported in tests");
    return pipe(data, new DecompressionStream(STREAM_FORMAT[format]));
  },
  async encode(data, format) {
    if (format === "brotli") throw new Error("brotli unsupported in tests");
    return pipe(data, new CompressionStream(STREAM_FORMAT[format]));
  },
};

describe("escape", () => {
  it("geçerli UTF-8'i olduğu gibi bırakır, ters bölüyü kaçışlar", () => {
    expect(escapeBytes(utf8("İstanbul ğüş \\ yol"))).toBe("İstanbul ğüş \\\\ yol");
  });

  it("geçersiz baytları ve denetim karakterlerini \\xNN yazar", () => {
    expect(escapeBytes(bytes(0xff, 0x00, 0x41, 0x0a, 0xc3))).toBe("\\xff\\x00A\n\\xc3");
  });

  it("her bayt dizisi için kayıpsız gidip gelir", () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(unescapeText(escapeBytes(all))).toEqual(all);
    const mixed = Uint8Array.from([...utf8("ağaç"), 0x80, 0xed, 0xa0, 0x80, ...utf8("😀"), 0xf4, 0x90, 0x80, 0x80]);
    expect(unescapeText(escapeBytes(mixed))).toEqual(mixed);
  });

  it("tanınmayan ters bölü dizisini düz metin sayar", () => {
    expect(text(unescapeText("a\\nb\\x4"))).toBe("a\\nb\\x4");
    expect(unescapeText("\\\\x41")).toEqual(utf8("\\x41"));
  });
});

describe("base64", () => {
  it("standart ve URL-güvenli biçimi korur", () => {
    const data = bytes(0xfb, 0xff, 0xbf, 0x01);
    const std = encodeBase64(data);
    expect(std).toBe("+/+/AQ==");
    const decoded = decodeBase64(std)!;
    expect(decoded.bytes).toEqual(data);
    expect(encodeBase64(decoded.bytes, decoded.style)).toBe(std);

    const url = decodeBase64("-_-_AQ")!;
    expect(url.bytes).toEqual(data);
    expect(url.style).toEqual({ url: true, pad: false });
    expect(encodeBase64(url.bytes, url.style)).toBe("-_-_AQ");
  });

  it("geçersiz girdiyi reddeder", () => {
    expect(decodeBase64("abc$")).toBeNull();
    expect(decodeBase64("a")).toBeNull();
    expect(decodeBase64("ab+_")).toBeNull();
    expect(decodeBase64("YQ=")).toBeNull();
    expect(decodeBase64("  aGVs\nbG8= ")!.bytes).toEqual(utf8("hello"));
  });

  it("rastgele baytlarda gidip gelir", () => {
    const data = Uint8Array.from({ length: 1000 }, (_, i) => (i * 7919) & 0xff);
    expect(decodeBase64(encodeBase64(data))!.bytes).toEqual(data);
  });
});

describe("hex", () => {
  const png = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x01);

  it("hexdump: konum | hex | ASCII", () => {
    expect(hexdump(png).split("\n")).toEqual([
      "00000000  89 50 4e 47 0d 0a 1a 0a  00 00 00 0d 49 48 44 52  |.PNG........IHDR|",
      "00000010  00 01                                             |..|",
    ]);
  });

  it("satır başına 16 bayt yazar ve geri okur", () => {
    const lines = toHexLines(png);
    expect(lines.split("\n")[1]).toBe("00 01");
    expect(parseHex(lines)).toEqual(png);
    expect(parseHex("DEADbeef\n 00")).toEqual(bytes(0xde, 0xad, 0xbe, 0xef, 0));
    expect(asciiOfHexLine("48 69 00 7e")).toBe("Hi.~");
  });

  it("geçersiz hex'te konumlu hata verir", () => {
    expect(() => parseHex("00 0g")).toThrow(HexError);
    try {
      parseHex("00 0g");
    } catch (err) {
      expect((err as HexError).code).toBe("char");
      expect((err as HexError).offset).toBe(4);
    }
    expect(() => parseHex("abc")).toThrowError(/odd/);
  });
});

describe("json", () => {
  it("büyük tamsayıları ve kayan noktayı ham metinle korur", () => {
    const node = parseJson('{"id": 12345678901234567890, "f": 1.0, "e": -2.5e-3}');
    expect(writeJson(node, 0)).toBe('{"id":12345678901234567890,"f":1.0,"e":-2.5e-3}');
  });

  it("anahtar sırasını korur (tamsayı benzeri anahtarlar dahil)", () => {
    expect(writeJson(parseJson('{"b":1,"2":2,"a":3,"1":4}'), 0)).toBe('{"b":1,"2":2,"a":3,"1":4}');
  });

  it("satır/sütunlu hata konumu verir", () => {
    const err = checkJson('{\n  "a": 1,\n  "b" 2\n}');
    expect(err).toBeInstanceOf(JsonSyntaxError);
    expect(err!.line).toBe(3);
    expect(err!.column).toBe(7);
    expect(checkJson('{"a": [1, 2]}')).toBeNull();
    expect(checkJson("[1,]")).not.toBeNull();
    expect(checkJson("01")).not.toBeNull();
  });

  it("güzelleştirme/küçültme dizgi kaçışlarına ve sayılara dokunmaz", () => {
    const raw = '{"s":"a\\u00e9 \\"q\\" , : {","n":1.50,"x":[],"o":{},"l":[1,{"k":null}]}';
    const pretty = formatJson(raw);
    expect(pretty).toBe('{\n  "s": "a\\u00e9 \\"q\\" , : {",\n  "n": 1.50,\n  "x": [],\n  "o": {},\n  "l": [\n    1,\n    {\n      "k": null\n    }\n  ]\n}');
    expect(minifyJson(pretty)).toBe(raw);
  });
});

describe("php unserialize", () => {
  const php = (s: string) => writeJson(phpToJson(utf8(s)), 0);

  it("temel türler", () => {
    expect(php("N;")).toBe("null");
    expect(php("b:1;")).toBe("true");
    expect(php("i:-42;")).toBe("-42");
    expect(php("d:1;")).toBe("1.0");
    expect(php("d:0.1;")).toBe("0.1");
    expect(php("d:INF;")).toBe('{"@float":"INF"}');
    expect(php('s:5:"hello";')).toBe('"hello"');
  });

  it("dizgi uzunluğu bayt cinsindendir", () => {
    expect(php('s:6:"ağaç";')).toBe('"ağaç"');
    expect(() => phpToJson(utf8('s:4:"ağaç";'))).toThrow();
  });

  it("sıralı dizi → JSON dizisi, diğerleri → nesne", () => {
    expect(php('a:2:{i:0;s:1:"a";i:1;s:1:"b";}')).toBe('["a","b"]');
    expect(php('a:2:{s:4:"name";s:3:"Ali";i:5;b:0;}')).toBe('{"name":"Ali","5":false}');
    expect(php("a:0:{}")).toBe("[]");
  });

  it("nesneler, özel serileştirme, başvurular", () => {
    expect(php('O:8:"stdClass":1:{s:1:"a";i:1;}')).toBe('{"@class":"stdClass","a":1}');
    expect(php('C:3:"Foo":6:{a:0:{}}')).toBe('{"@class":"Foo","@data":"a:0:{}"}');
    expect(php("a:2:{i:0;i:1;i:1;r:2;}")).toBe('[1,{"@ref":2}]');
  });

  it("geri serileştirme özgün baytları üretir", () => {
    const samples = [
      'a:3:{s:4:"name";s:8:"Ayşe Ç";s:3:"age";i:30;s:4:"tags";a:2:{i:0;s:1:"x";i:1;d:1.5;}}',
      'O:4:"User":2:{s:2:"id";i:7;s:11:"\0*\0password";N;}',
      'a:2:{i:10;s:1:"a";s:2:"05";b:1;}',
      'C:3:"Foo":6:{a:0:{}}',
      "d:1.0E+25;",
      'E:7:"Foo:Bar";',
    ];
    for (const sample of samples) expect(text(jsonToPhp(phpToJson(utf8(sample))))).toBe(sample);
  });

  it("JSON düzenlemesinden PHP'ye: sayısal anahtar tamsayı olur, 1.0 kayan nokta kalır", () => {
    expect(text(jsonToPhp(parseJson('{"3":1.0,"x":[true,null]}')))).toBe('a:2:{i:3;d:1.0;s:1:"x";a:2:{i:0;b:1;i:1;N;}}');
  });
});

describe("msgpack", () => {
  it("@msgpack/msgpack çıktısını çözer", () => {
    const value = { name: "Ayşe", n: 300, neg: -129, list: [1, 2.5, true, null], nested: { a: "b" } };
    const node = msgpackToJson(mpEncode(value));
    expect(JSON.parse(writeJson(node, 0))).toEqual(value);
  });

  it("64 bit tamsayı ve 1.0 kayan nokta korunur", () => {
    const encoded = mpEncode({ big: 2n ** 63n - 1n, f: 1.0, small: 1 }, { useBigInt64: true, forceIntegerToFloat: false });
    // 1.0 JS'te tamsayıdır; kayan noktayı elle yazarız: cb (float64) 1.0
    const node = msgpackToJson(encoded);
    expect(writeJson(node, 0)).toContain('"big":9223372036854775807');
    const floatOne = msgpackToJson(bytes(0xcb, 0x3f, 0xf0, 0, 0, 0, 0, 0, 0));
    expect(writeJson(floatOne)).toBe("1.0");
    expect(jsonToMsgpack(floatOne)).toEqual(bytes(0xcb, 0x3f, 0xf0, 0, 0, 0, 0, 0, 0));
  });

  it("gidip gelir; ikili ve dizgi olmayan anahtarlar özel nesnelerle taşınır", () => {
    const original = Uint8Array.from([0x82, 0x01, 0xa3, ...utf8("one"), 0xa3, ...utf8("bin"), 0xc4, 3, 1, 2, 3]);
    const node = msgpackToJson(original);
    expect(writeJson(node, 0)).toBe('{"@map":[[1,"one"],["bin",{"@bin":"AQID"}]]}');
    expect(jsonToMsgpack(parseJson(writeJson(node)))).toEqual(original);
  });

  it("JSON düzenlemesi kütüphane ile aynı değeri kodlar", () => {
    const json = '{"id":12,"neg":-40000,"big":18446744073709551615,"s":"' + "x".repeat(40) + '","arr":[1.25,false]}';
    const packed = jsonToMsgpack(parseJson(json));
    expect(mpDecode(packed, { useBigInt64: true })).toEqual({ id: 12, neg: -40000, big: 18446744073709551615n, s: "x".repeat(40), arr: [1.25, false] });
  });

  it("yalnızca tam çözülen kap değerleri algılar", () => {
    expect(looksLikeMsgpack(mpEncode({ a: 1 }))).toBe(true);
    expect(looksLikeMsgpack(mpEncode([1, 2]))).toBe(true);
    expect(looksLikeMsgpack(Uint8Array.from([...mpEncode({ a: 1 }), 0]))).toBe(false);
    expect(looksLikeMsgpack(utf8("hello"))).toBe(false);
  });
});

describe("biçim algılama ve gidiş-dönüş", () => {
  it("algılar", async () => {
    expect(detectFormat(utf8('{"a":1}'))).toBe("json");
    expect(detectFormat(utf8("[1,2"))).toBe("text");
    expect(detectFormat(utf8("merhaba"))).toBe("text");
    expect(detectFormat(await nodeCodec.encode(utf8('{"a":1}'), "gzip"))).toBe("gzip");
    expect(detectFormat(await nodeCodec.encode(utf8("x".repeat(100)), "zlib"))).toBe("zlib");
    expect(detectFormat(utf8('a:1:{i:0;s:1:"a";}'))).toBe("php");
    expect(detectFormat(mpEncode({ a: [1, 2] }))).toBe("msgpack");
    expect(detectFormat(bytes(0x89, 0x50, 0x4e, 0x47, 0, 1, 2))).toBe("hex");
    expect(detectFormat(utf8("x^ zlib değil"))).toBe("text");
  });

  it("JSON güzel gösterilir, düzenlenen metin olduğu gibi ya da küçültülerek yazılır", async () => {
    const d = await decodeValue(utf8('{"a":1,"b":[true]}'), "auto", nodeCodec);
    expect(d).toMatchObject({ format: "json", detected: true, lang: "json", compact: true });
    expect(d.text).toBe('{\n  "a": 1,\n  "b": [\n    true\n  ]\n}');
    expect(text(await encodeValue(d.text, d, nodeCodec, { minify: true }))).toBe('{"a":1,"b":[true]}');
    expect(text(await encodeValue('{ "a": 2 }', d, nodeCodec, { minify: false }))).toBe('{ "a": 2 }');
    await expect(encodeValue('{"a":}', d, nodeCodec, { minify: true })).rejects.toBeInstanceOf(FormatError);
  });

  it("sıkıştırılmış biçimler çözülür ve yeniden sıkıştırılır", async () => {
    for (const format of ["gzip", "deflate", "zlib"] as const) {
      const packed = await nodeCodec.encode(utf8('{"city":"İzmir"}'), format);
      const d = await decodeValue(packed, format, nodeCodec);
      expect(d.lang).toBe("json");
      const repacked = await encodeValue(d.text.replace("İzmir", "Iğdır"), d, nodeCodec, { minify: true });
      expect(text(await nodeCodec.decode(repacked, format))).toBe('{"city":"Iğdır"}');
    }
  });

  it("base64 içeriği çözülür, aynı alfabeyle geri yazılır", async () => {
    const d = await decodeValue(utf8("aGVsbG8gZMO8bnlh"), "base64", nodeCodec);
    expect(d.text).toBe("hello dünya");
    expect(text(await encodeValue("hello dünya", d, nodeCodec, { minify: false }))).toBe("aGVsbG8gZMO8bnlh");
    await expect(decodeValue(utf8("not base64!"), "base64", nodeCodec)).rejects.toMatchObject({ code: "notBase64" });
  });

  it("ikili değer metin olarak kaçışlı gösterilir ve kayıpsız kaydedilir", async () => {
    const raw = bytes(0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 0x5c);
    const d = await decodeValue(raw, "text", nodeCodec);
    expect(d.escaped).toBe(true);
    expect(await encodeValue(d.text, d, nodeCodec, { minify: false })).toEqual(raw);
    const h = await decodeValue(raw, "hex", nodeCodec);
    expect(h.text).toBe("89 50 4e 47 00 01 02 5c");
    await expect(encodeValue("89 5", h, nodeCodec, { minify: false })).rejects.toMatchObject({ code: "hexOdd" });
  });

  it("msgpack ve PHP JSON olarak düzenlenip geri kodlanır", async () => {
    const packed = mpEncode({ a: 1, b: "x" });
    const m = await decodeValue(packed, "auto", nodeCodec);
    expect(m.format).toBe("msgpack");
    expect(await encodeValue(m.text, m, nodeCodec, { minify: false })).toEqual(packed);

    const serialized = utf8('a:1:{s:1:"k";s:1:"v";}');
    const p = await decodeValue(serialized, "auto", nodeCodec);
    expect(p.format).toBe("php");
    expect(text(await encodeValue(p.text.replace('"v"', '"w"'), p, nodeCodec, { minify: false }))).toBe('a:1:{s:1:"k";s:1:"w";}');
  });

  it("yanlış algılanan bozuk sıkıştırma güvenli gösterime düşer", async () => {
    const broken = bytes(0x1f, 0x8b, 0x08, 0x00, 0x01);
    const d = await decodeValue(broken, "auto", nodeCodec);
    expect(d.format).toBe("hex");
    await expect(decodeValue(broken, "gzip", nodeCodec)).rejects.toMatchObject({ code: "codec" });
  });
});
