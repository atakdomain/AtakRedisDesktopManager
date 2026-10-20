import { describe, expect, it } from "vitest";
import type { ConnectionConfig } from "$lib/api/types";
import { emptyConnection } from "$lib/state/connections.svelte";
import { normalizeConnection, validateConnection } from "./validate";

function make(patch: (c: ConnectionConfig) => void): ConnectionConfig {
  const c = emptyConnection();
  patch(c);
  return c;
}

describe("validateConnection", () => {
  it("accepts the defaults", () => {
    expect(validateConnection(emptyConnection())).toEqual({});
  });

  it("requires a host and a valid port", () => {
    const errors = validateConnection(make((c) => ((c.host = "  "), (c.port = 0))));
    expect(Object.keys(errors).sort()).toEqual(["host", "port"]);
    expect(validateConnection(make((c) => (c.port = 65536))).port).toBeDefined();
    expect(validateConnection(make((c) => (c.port = null as unknown as number))).port).toBeDefined();
  });

  it("ignores db in cluster mode", () => {
    expect(validateConnection(make((c) => ((c.mode = "cluster"), (c.db = -1))))).toEqual({});
    expect(validateConnection(make((c) => (c.db = -1))).db).toBeDefined();
  });

  it("requires a master name for sentinel", () => {
    expect(validateConnection(make((c) => ((c.mode = "sentinel"), (c.sentinel.masterName = "")))).masterName).toBeDefined();
  });

  it("checks SSH fields only when SSH is on", () => {
    expect(validateConnection(make((c) => (c.ssh.host = "")))).toEqual({});
    const errors = validateConnection(make((c) => ((c.ssh.enabled = true), (c.ssh.auth = "privateKey"))));
    expect(Object.keys(errors).sort()).toEqual(["sshHost", "sshKey", "sshUser"]);
    const agent = validateConnection(make((c) => ((c.ssh.enabled = true), (c.ssh.auth = "agent"), (c.ssh.host = "b"), (c.ssh.username = "u"))));
    expect(agent).toEqual({});
  });
});

describe("normalizeConnection", () => {
  it("trims text and forces db 0 on cluster", () => {
    const c = normalizeConnection(make((c) => ((c.name = " a "), (c.host = " h "), (c.mode = "cluster"), (c.db = 3))));
    expect(c).toMatchObject({ name: "a", host: "h", db: 0 });
  });
});
