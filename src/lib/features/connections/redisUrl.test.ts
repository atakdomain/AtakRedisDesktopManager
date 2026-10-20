import { describe, expect, it } from "vitest";
import { emptyConnection } from "$lib/state/connections.svelte";
import { applyRedisUrl, formatRedisUrl, parseRedisUrl } from "./redisUrl";

describe("parseRedisUrl", () => {
  it("parses a bare host", () => {
    expect(parseRedisUrl("redis://cache.local")).toEqual({ host: "cache.local", port: 6379, username: "", password: "", db: null, tls: false });
  });

  it("parses user, password, port and db", () => {
    expect(parseRedisUrl("redis://app:s3cret@10.0.0.5:6380/3")).toEqual({ host: "10.0.0.5", port: 6380, username: "app", password: "s3cret", db: 3, tls: false });
  });

  it("treats rediss as TLS", () => {
    expect(parseRedisUrl("rediss://:pw@redis.example.com:6380")?.tls).toBe(true);
  });

  it("accepts a password-only userinfo", () => {
    const parsed = parseRedisUrl("redis://:only-pass@host:7000/0");
    expect(parsed?.username).toBe("");
    expect(parsed?.password).toBe("only-pass");
    expect(parsed?.db).toBe(0);
  });

  it("treats userinfo without a colon as the username", () => {
    expect(parseRedisUrl("redis://default@host")?.username).toBe("default");
  });

  it("decodes percent-encoded credentials", () => {
    const parsed = parseRedisUrl("redis://us%40er:p%3Ass%2Fw%23rd@host:6379");
    expect(parsed?.username).toBe("us@er");
    expect(parsed?.password).toBe("p:ss/w#rd");
  });

  it("tolerates unencoded special characters in the password", () => {
    const parsed = parseRedisUrl("redis://:p@ss/w#rd:x@host:6379/2");
    expect(parsed?.password).toBe("p@ss/w#rd:x");
    expect(parsed?.host).toBe("host");
    expect(parsed?.db).toBe(2);
  });

  it("parses IPv6 hosts in brackets", () => {
    expect(parseRedisUrl("redis://[::1]:6390")).toMatchObject({ host: "::1", port: 6390 });
    expect(parseRedisUrl("redis://[fe80::1]")).toMatchObject({ host: "fe80::1", port: 6379 });
  });

  it("reads db from the query string", () => {
    expect(parseRedisUrl("redis://host:6379?db=5")?.db).toBe(5);
  });

  it("is case-insensitive on the scheme and trims whitespace", () => {
    expect(parseRedisUrl("  REDISS://Host:1234  ")).toMatchObject({ host: "Host", port: 1234, tls: true });
  });

  it("accepts host:port without a scheme", () => {
    expect(parseRedisUrl("10.1.2.3:6380")).toMatchObject({ host: "10.1.2.3", port: 6380, tls: false });
    expect(parseRedisUrl("localhost")).toMatchObject({ host: "localhost", port: 6379 });
  });

  it("rejects invalid input", () => {
    for (const bad of ["", "http://host", "redis://", "redis://host:0", "redis://host:70000", "redis://host:abc", "redis://host/x", "hello world", "redis://[::1"]) {
      expect(parseRedisUrl(bad), bad).toBeNull();
    }
  });
});

describe("formatRedisUrl", () => {
  it("never includes the password", () => {
    const c = { ...emptyConnection(), host: "h", port: 6380, username: "app", password: "secret", db: 2 };
    expect(formatRedisUrl(c)).toBe("redis://app@h:6380/2");
  });

  it("uses rediss for TLS and omits db 0", () => {
    const c = emptyConnection();
    c.tls.enabled = true;
    c.host = "::1";
    expect(formatRedisUrl(c)).toBe("rediss://[::1]:6379");
  });

  it("round-trips through the parser", () => {
    const c = { ...emptyConnection(), host: "redis.example.com", port: 6390, username: "a b", db: 4 };
    const parsed = parseRedisUrl(formatRedisUrl(c));
    expect(parsed).toMatchObject({ host: "redis.example.com", port: 6390, username: "a b", db: 4, password: "" });
  });
});

describe("applyRedisUrl", () => {
  it("fills the form and keeps db when the URL has none", () => {
    const c = { ...emptyConnection(), db: 7 };
    applyRedisUrl(c, parseRedisUrl("rediss://u:p@host:1")!);
    expect(c).toMatchObject({ host: "host", port: 1, username: "u", password: "p", db: 7 });
    expect(c.tls.enabled).toBe(true);
  });
});
