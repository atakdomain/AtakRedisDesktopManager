import { describe, expect, it } from "vitest";
import { quoteArg, splitLines, tokenize } from "./parse";

describe("tokenize (sdssplitargs)", () => {
  it("boşluklar ve tırnaklar", () => {
    expect(tokenize('SET "a b" \'c d\' e').tokens).toEqual(["SET", "a b", "c d", "e"]);
    expect(tokenize("  GET   foo  ").tokens).toEqual(["GET", "foo"]);
  });

  it("çift tırnakta kaçışlar", () => {
    expect(tokenize('SET k "x\\ny\\x41\\"z"').tokens).toEqual(["SET", "k", 'x\nyA"z']);
  });

  it("tek tırnakta yalnızca \\' kaçışı", () => {
    expect(tokenize("SET k 'it\\'s \\n'").tokens).toEqual(["SET", "k", "it's \\n"]);
  });

  it("kapanmayan tırnak hata", () => {
    expect(tokenize('SET "abc').error).toBe(true);
    expect(tokenize('SET "abc"x').error).toBe(true);
  });

  it("sondaki boşluk bilgisi", () => {
    expect(tokenize("GET ").trailingSpace).toBe(true);
    expect(tokenize("GET").trailingSpace).toBe(false);
    expect(tokenize("").tokens).toEqual([]);
  });
});

describe("quoteArg", () => {
  it("gerekmezse tırnaksız", () => {
    expect(quoteArg("news")).toBe("news");
    expect(quoteArg("ğüş")).toBe("ğüş");
  });

  it("boşluk, tırnak, satır sonu kaçışlanır ve geri okunur", () => {
    for (const value of ["a b", 'say "hi"', "line1\nline2", "", "back\\slash", "it's"]) {
      const quoted = quoteArg(value);
      expect(tokenize(`PUBLISH ch ${quoted}`).tokens[2]).toBe(value);
    }
  });
});

describe("splitLines", () => {
  it("boş satırları atar", () => {
    expect(splitLines("GET a\r\n\n  SET b 1  \n")).toEqual(["GET a", "SET b 1"]);
  });
});
