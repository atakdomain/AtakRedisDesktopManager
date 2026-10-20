import { describe, expect, it } from "vitest";
import { parseClientList } from "./clients";
import { keyspace, parseInfo, parseKv, summarize } from "./info";

const INFO = [
  "# Server",
  "redis_version:7.2.4",
  "redis_mode:standalone",
  "os:Linux 6.5.0 x86_64",
  "uptime_in_seconds:1036800",
  "",
  "# Memory",
  "used_memory:734003200",
  "used_memory_peak:912261120",
  "maxmemory:0",
  "maxmemory_policy:noeviction",
  "mem_fragmentation_ratio:1.08",
  "",
  "# Stats",
  "instantaneous_ops_per_sec:812",
  "keyspace_hits:90",
  "keyspace_misses:10",
  "",
  "# Replication",
  "role:slave",
  "master_host:10.0.0.1",
  "master_port:6379",
  "master_link_status:up",
  "",
  "# Keyspace",
  "db0:keys=2400,expires=600,avg_ttl=3600000",
  "db10:keys=5,expires=0,avg_ttl=0",
  "db1:keys=120,expires=0,avg_ttl=0",
].join("\r\n");

describe("parseInfo", () => {
  it("bölümler ve anahtarlar", () => {
    const info = parseInfo(INFO);
    expect(info.sections.map((s) => s.name)).toEqual(["Server", "Memory", "Stats", "Replication", "Keyspace"]);
    expect(info.map.get("redis_version")).toBe("7.2.4");
    expect(info.map.get("os")).toBe("Linux 6.5.0 x86_64");
    expect(info.sections[0].entries[0]).toEqual(["redis_version", "7.2.4"]);
  });

  it("değerde iki nokta kalır", () => {
    expect(parseInfo("# X\r\nexecutable:/usr/bin/redis:server\r\n").map.get("executable")).toBe("/usr/bin/redis:server");
  });

  it("keyspace sıralı ve sayısal", () => {
    expect(keyspace(parseInfo(INFO))).toEqual([
      { db: 0, keys: 2400, expires: 600, avgTtl: 3600000 },
      { db: 1, keys: 120, expires: 0, avgTtl: 0 },
      { db: 10, keys: 5, expires: 0, avgTtl: 0 },
    ]);
    expect(parseKv("calls=5,usec=10")).toEqual({ calls: "5", usec: "10" });
  });

  it("özet: isabet oranı, rol, eksik alanlar null", () => {
    const s = summarize(parseInfo(INFO));
    expect(s.version).toBe("7.2.4");
    expect(s.hitRatio).toBeCloseTo(0.9);
    expect(s.maxMemory).toBe(0);
    expect(s.role).toBe("slave");
    expect(s.masterHost).toBe("10.0.0.1:6379");
    expect(s.clients).toBeNull();
    expect(s.aofEnabled).toBeNull();
    expect(summarize(parseInfo("# Stats\r\nkeyspace_hits:0\r\nkeyspace_misses:0")).hitRatio).toBeNull();
  });
});

describe("parseClientList", () => {
  it("satır başına alanlar; boş ad korunur", () => {
    const text =
      "id=3 addr=127.0.0.1:52144 laddr=127.0.0.1:6379 fd=8 name= age=120 idle=0 flags=N db=0 cmd=client|list user=default\n" +
      "id=4 addr=10.0.0.5:51234 fd=9 name=worker age=3600 idle=2 flags=N db=2 cmd=get\n\n";
    const clients = parseClientList(text);
    expect(clients).toHaveLength(2);
    expect(clients[0]).toMatchObject({ id: 3, addr: "127.0.0.1:52144", name: "", age: 120, db: 0, cmd: "client|list", user: "default" });
    expect(clients[0].fields.laddr).toBe("127.0.0.1:6379");
    expect(clients[1]).toMatchObject({ id: 4, name: "worker", idle: 2, db: 2, user: "" });
  });
});
