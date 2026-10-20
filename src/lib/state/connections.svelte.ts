import { api, ApiError } from "$lib/api";
import type { ConnectionConfig, SessionInfo } from "$lib/api/types";

export type ConnStatus = "idle" | "connecting" | "connected" | "error";

export function emptyConnection(): ConnectionConfig {
  return {
    id: "",
    name: "",
    group: "",
    color: "",
    env: "none",
    mode: "standalone",
    host: "127.0.0.1",
    port: 6379,
    username: "",
    password: "",
    db: 0,
    separator: ":",
    readOnly: false,
    timeoutSec: 10,
    sentinel: { masterName: "mymaster", sentinelUsername: "", sentinelPassword: "" },
    tls: { enabled: false, caPath: "", certPath: "", keyPath: "", skipVerify: false, serverName: "" },
    ssh: { enabled: false, host: "", port: 22, username: "", auth: "password", password: "", privateKeyPath: "", passphrase: "", timeoutSec: 30 },
    order: 0,
    importedFrom: "",
  };
}

class ConnectionsState {
  list = $state<ConnectionConfig[]>([]);
  loaded = $state(false);
  activeId = $state<string | null>(null);
  status = $state<Record<string, ConnStatus>>({});
  sessions = $state<Record<string, SessionInfo>>({});
  errors = $state<Record<string, ApiError>>({});

  active = $derived(this.list.find((c) => c.id === this.activeId));
  activeSession = $derived(this.activeId ? this.sessions[this.activeId] : undefined);

  byId(id: string): ConnectionConfig | undefined {
    return this.list.find((c) => c.id === id);
  }

  async load(): Promise<void> {
    this.list = await api.connections.list();
    this.loaded = true;
  }

  async save(config: ConnectionConfig): Promise<ConnectionConfig> {
    const saved = await api.connections.save(config);
    const index = this.list.findIndex((c) => c.id === saved.id);
    if (index >= 0) this.list[index] = saved;
    else this.list.push(saved);
    // Arka uç kaydedilen bağlantının açık oturumunu kapatır; arayüz de yeniden bağlanmaya hazırlanır
    if (index >= 0 && this.status[saved.id] === "connected") {
      this.status[saved.id] = "idle";
      delete this.sessions[saved.id];
      void this.connect(saved.id);
    }
    return saved;
  }

  async saveMany(configs: ConnectionConfig[]): Promise<ConnectionConfig[]> {
    const saved = await api.connections.saveMany(configs);
    await this.load();
    return saved;
  }

  async remove(id: string): Promise<void> {
    await api.connections.remove(id);
    this.list = this.list.filter((c) => c.id !== id);
    delete this.status[id];
    delete this.sessions[id];
    delete this.errors[id];
    if (this.activeId === id) this.activeId = null;
  }

  async reorder(ids: string[]): Promise<void> {
    const order = new Map(ids.map((id, i) => [id, i]));
    this.list = [...this.list].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    this.list.forEach((c, i) => (c.order = i));
    await api.connections.reorder(ids);
  }

  /** Bağlanır ve etkin bağlantı yapar. Başarısızsa hata `errors[id]`'de kalır. */
  async connect(id: string, force = false): Promise<SessionInfo | null> {
    this.activeId = id;
    if (!force && this.status[id] === "connected" && this.sessions[id]) return this.sessions[id];
    this.status[id] = "connecting";
    delete this.errors[id];
    try {
      const info = await api.session.open(id);
      this.sessions[id] = info;
      this.status[id] = "connected";
      return info;
    } catch (err) {
      this.status[id] = "error";
      this.errors[id] = err instanceof ApiError ? err : new ApiError("internal", String(err));
      return null;
    }
  }

  async disconnect(id: string): Promise<void> {
    await api.session.close(id).catch(() => undefined);
    this.status[id] = "idle";
    delete this.sessions[id];
  }

  /** Bağlantı koptuğunda (connection hatası) çağrılır: durum hataya döner, sonraki işlem yeniden bağlanır. */
  markLost(id: string, err: ApiError): void {
    if (err.kind !== "connection" && err.kind !== "timeout") return;
    this.status[id] = "error";
    this.errors[id] = err;
  }

  groups = $derived.by(() => {
    const names = new Set(this.list.map((c) => c.group).filter(Boolean));
    return [...names].sort((a, b) => a.localeCompare(b));
  });
}

export const connections = new ConnectionsState();
