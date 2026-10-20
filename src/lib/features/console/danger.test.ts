import { describe, expect, it } from "vitest";
import { dangerOf, KEYS_BIG_DB } from "./danger";
import { tokenize } from "./parse";

const d = (line: string, dbSize?: number) => dangerOf(tokenize(line).tokens, { dbSize });

describe("dangerOf", () => {
  it("doğrudan tehlikeli komutlar (büyük/küçük harf fark etmez)", () => {
    expect(d("FLUSHALL")).toBe("flush");
    expect(d("flushdb async")).toBe("flush");
    expect(d("shutdown nosave")).toBe("shutdown");
    expect(d("DEBUG SLEEP 10")).toBe("debug");
    expect(d("replicaof 10.0.0.1 6379")).toBe("replication");
    expect(d("SWAPDB 0 1")).toBe("swapdb");
  });

  it("alt komuta bağlı olanlar", () => {
    expect(d("CONFIG SET maxmemory 1gb")).toBe("config");
    expect(d("config resetstat")).toBe("config");
    expect(d("CONFIG REWRITE")).toBe("config");
    expect(d("CONFIG GET *")).toBeNull();
    expect(d("SCRIPT FLUSH")).toBe("script");
    expect(d("SCRIPT LOAD x")).toBeNull();
    expect(d("FUNCTION FLUSH")).toBe("script");
    expect(d("CLUSTER RESET HARD")).toBe("cluster");
    expect(d("cluster failover")).toBe("cluster");
    expect(d("CLUSTER INFO")).toBeNull();
    expect(d("CLIENT KILL ID 5")).toBe("client");
    expect(d("CLIENT LIST")).toBeNull();
  });

  it("KEYS yalnızca joker + büyük veritabanında", () => {
    expect(d("KEYS *", KEYS_BIG_DB + 1)).toBe("keys");
    expect(d("KEYS user:*", 50_000)).toBe("keys");
    expect(d("KEYS *", 100)).toBeNull();
    expect(d("KEYS exact-key", 50_000)).toBeNull();
    expect(d("KEYS *")).toBeNull();
  });

  it("zararsız komutlar", () => {
    expect(d("GET foo")).toBeNull();
    expect(d("DEL foo")).toBeNull();
    expect(d("")).toBeNull();
  });
});
