// Bağlantı formu doğrulaması. Hata metni çeviri anahtarı olarak döner.
import type { ConnectionConfig } from "$lib/api/types";
import type { TKey } from "$lib/i18n/index.svelte";

export type Field = "host" | "port" | "db" | "timeoutSec" | "masterName" | "sshHost" | "sshPort" | "sshUser" | "sshKey" | "sshTimeout";
export type Section = "general" | "tls" | "ssh";

export const FIELD_SECTION: Record<Field, Section> = {
  host: "general",
  port: "general",
  db: "general",
  timeoutSec: "general",
  masterName: "general",
  sshHost: "ssh",
  sshPort: "ssh",
  sshUser: "ssh",
  sshKey: "ssh",
  sshTimeout: "ssh",
};

/** Formdaki sıra: ilk hatalı alana odaklanmak için */
export const FIELD_ORDER = Object.keys(FIELD_SECTION) as Field[];

function validPort(port: unknown): boolean {
  return typeof port === "number" && Number.isInteger(port) && port >= 1 && port <= 65535;
}

function validTimeout(sec: unknown): boolean {
  return typeof sec === "number" && Number.isFinite(sec) && sec >= 1 && sec <= 300;
}

export function validateConnection(c: ConnectionConfig): Partial<Record<Field, TKey>> {
  const errors: Partial<Record<Field, TKey>> = {};
  if (!c.host?.trim()) errors.host = "connections.editor.validation.host";
  if (!validPort(c.port)) errors.port = "connections.editor.validation.port";
  if (c.mode !== "cluster" && !(typeof c.db === "number" && Number.isInteger(c.db) && c.db >= 0)) errors.db = "connections.editor.validation.db";
  if (!validTimeout(c.timeoutSec)) errors.timeoutSec = "connections.editor.validation.timeout";
  if (c.mode === "sentinel" && !c.sentinel.masterName.trim()) errors.masterName = "connections.editor.validation.masterName";
  if (c.ssh.enabled) {
    if (!c.ssh.host.trim()) errors.sshHost = "connections.editor.validation.sshHost";
    if (!validPort(c.ssh.port)) errors.sshPort = "connections.editor.validation.port";
    if (!c.ssh.username.trim()) errors.sshUser = "connections.editor.validation.sshUser";
    if (c.ssh.auth === "privateKey" && !c.ssh.privateKeyPath.trim()) errors.sshKey = "connections.editor.validation.keyFile";
    if (!validTimeout(c.ssh.timeoutSec)) errors.sshTimeout = "connections.editor.validation.timeout";
  }
  return errors;
}

/** Kaydetmeden önce: boşlukları kırp, cluster'da db 0 */
export function normalizeConnection(c: ConnectionConfig): ConnectionConfig {
  const out = structuredClone(c);
  out.name = out.name.trim();
  out.host = out.host.trim();
  out.group = out.group.trim();
  out.sentinel.masterName = out.sentinel.masterName.trim();
  out.tls.caPath = out.tls.caPath.trim();
  out.tls.certPath = out.tls.certPath.trim();
  out.tls.keyPath = out.tls.keyPath.trim();
  out.tls.serverName = out.tls.serverName.trim();
  out.ssh.host = out.ssh.host.trim();
  out.ssh.username = out.ssh.username.trim();
  out.ssh.privateKeyPath = out.ssh.privateKeyPath.trim();
  if (out.mode === "cluster") out.db = 0;
  return out;
}
