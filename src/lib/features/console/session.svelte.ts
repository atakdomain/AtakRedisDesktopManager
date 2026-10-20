// Bağlantı başına konsol durumu: çıktı blokları, seçili db/düğüm, yazılmakta olan satır, geçmiş ve sıralı yürütme.
// Bileşenin dışında tutulur: sekme gizlenince, bağlantı değişip geri gelince ekran ve kuyruk korunur.
import { api, ApiError } from "$lib/api";
import { t } from "$lib/i18n/index.svelte";
import { connections } from "$lib/state/connections.svelte";
import { confirm } from "$lib/state/dialogs.svelte";
import { settings } from "$lib/state/settings.svelte";
import type { Workspace } from "$lib/state/workspace.svelte";
import { COMMANDS, CONTAINERS, lookupCommand, type CommandGroup } from "./commands";
import { dangerOf, type DangerReason } from "./danger";
import { formatRaw, formatReply, isRawCommand, textLines, type FLine } from "./format";
import { isSensitive, pushHistory } from "./history";
import { tokenize } from "./parse";

export type BlockState = "queued" | "running" | "done" | "cancelled";
export type BlockKind = "reply" | "readOnly" | "failed" | "info" | "stream" | "declined";

export interface StreamRequest {
  channels: string[];
  patterns: string[];
  monitor: boolean;
}

export interface Block {
  id: number;
  line: string;
  db: number;
  node: string;
  state: BlockState;
  kind: BlockKind;
  lines: FLine[];
  /** failed/readOnly/declined/cancelled için açıklama */
  message: string;
  elapsedMs: number | null;
  startedAt: number;
  expanded: boolean;
  stream?: StreamRequest;
}

/** Ekranda tutulan en fazla blok; eskiler düşer */
export const MAX_BLOCKS = 400;

const STREAM_COMMANDS = new Set(["SUBSCRIBE", "PSUBSCRIBE", "SSUBSCRIBE", "UNSUBSCRIBE", "PUNSUBSCRIBE", "SUNSUBSCRIBE", "MONITOR"]);

function storeName(connectionId: string): string {
  return `console-history-${connectionId.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`;
}

export class ConsoleSession {
  readonly connectionId: string;

  blocks = $state.raw<Block[]>([]);
  db = $state(0);
  node = $state("");
  draft = $state("");
  busy = $state(false);
  history = $state.raw<string[]>([]);

  private nextId = 1;
  private queue: number[] = [];
  private detach: (() => void) | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(connectionId: string, db: number) {
    this.connectionId = connectionId;
    this.db = db;
    void this.loadHistory();
  }

  private async loadHistory(): Promise<void> {
    const stored = await api.app.storeGet<string[]>(storeName(this.connectionId)).catch(() => null);
    if (!Array.isArray(stored)) return;
    // Yükleme sürerken yazılanlar kaybolmasın
    let merged = stored.filter((x) => typeof x === "string");
    for (const line of this.history) merged = pushHistory(merged, line);
    this.history = merged;
  }

  remember(line: string): void {
    this.history = pushHistory(this.history, line);
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      void api.app.storeSet(storeName(this.connectionId), this.history.filter((x) => !isSensitive(x))).catch(() => undefined);
    }, 500);
  }

  get(id: number): Block | undefined {
    return this.blocks.find((b) => b.id === id);
  }

  private add(line: string, patch: Partial<Block> = {}): Block {
    const block: Block = {
      id: this.nextId++,
      line,
      db: this.db,
      node: this.node,
      state: "done",
      kind: "info",
      lines: [],
      message: "",
      elapsedMs: null,
      startedAt: Date.now(),
      expanded: false,
      ...patch,
    };
    const next = [...this.blocks, block];
    this.blocks = next.length > MAX_BLOCKS ? next.slice(next.length - MAX_BLOCKS) : next;
    return block;
  }

  patch(id: number, patch: Partial<Block>): void {
    this.blocks = this.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b));
  }

  /** Bekleyen ve çalışan bloklar kalır */
  clear(): void {
    this.blocks = this.blocks.filter((b) => b.state === "running" || b.state === "queued");
  }

  /** Çalışan komutun yanıtını beklemeyi bırakır, kuyruğu boşaltır. */
  cancel(): void {
    for (const id of this.queue) this.patch(id, { state: "cancelled", kind: "declined", message: "" });
    this.queue = [];
    this.detach?.();
  }

  /** Satırları sırayla çalıştırır; biri reddedilirse kalanlar iptal olur. */
  async enqueue(lines: string[], ws: Workspace): Promise<void> {
    for (const line of lines) {
      this.remember(line);
      this.queue.push(this.add(line, { state: "queued", kind: "reply" }).id);
    }
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queue.length) {
        const id = this.queue.shift()!;
        const block = this.get(id);
        if (!block || block.state !== "queued") continue;
        const proceed = await this.execute(block, ws);
        if (!proceed) this.cancel();
      }
    } finally {
      this.busy = false;
    }
  }

  /** false → kullanıcı onay vermedi, toplu çalıştırma durur */
  private async execute(block: Block, ws: Workspace): Promise<boolean> {
    const { tokens, error } = tokenize(block.line);
    const base = { db: this.db, node: this.node, startedAt: Date.now() };
    if (error) {
      this.patch(block.id, { ...base, state: "done", kind: "reply", lines: textLines(`(error) ${t("console.invalidArgs")}`, "err") });
      return true;
    }
    const name = tokens[0]?.toUpperCase() ?? "";

    if (name === "CLEAR") {
      this.blocks = this.blocks.filter((b) => b.id !== block.id && (b.state === "running" || b.state === "queued"));
      return true;
    }
    if (name === "HELP") {
      this.patch(block.id, { ...base, state: "done", kind: "info", lines: helpLines(tokens.slice(1)) });
      return true;
    }
    if (name === "QUIT" || name === "EXIT") {
      this.patch(block.id, { ...base, state: "done", kind: "info", lines: textLines(t("console.quitNote")) });
      return true;
    }
    if (STREAM_COMMANDS.has(name)) {
      const args = tokens.slice(1);
      const stream: StreamRequest = {
        channels: name === "SUBSCRIBE" || name === "SSUBSCRIBE" ? args : [],
        patterns: name === "PSUBSCRIBE" ? args : [],
        monitor: name === "MONITOR",
      };
      this.patch(block.id, { ...base, state: "done", kind: "stream", stream });
      return true;
    }

    const conn = connections.byId(this.connectionId);
    const production = conn?.env === "production";
    const reason = dangerOf(tokens, { dbSize: ws.dbs.find((d) => d.index === this.db)?.keys });
    if (reason && (production || settings.confirmDangerous)) {
      const ok = await confirmDanger(reason, block.line, production ? conn?.name || conn?.host || "" : "", ws.dbs.find((d) => d.index === this.db)?.keys ?? 0);
      if (!ok) {
        this.patch(block.id, { ...base, state: "cancelled", kind: "declined", message: t("console.declined") });
        return false;
      }
    }

    this.patch(block.id, { ...base, state: "running" });
    let detached = false;
    const cancelled = new Promise<null>((resolve) => {
      this.detach = () => {
        detached = true;
        resolve(null);
      };
    });
    try {
      const reply = await Promise.race([api.console.exec(this.connectionId, this.db, block.line, this.node), cancelled]);
      if (detached || reply === null) {
        this.patch(block.id, { state: "cancelled", kind: "declined", message: t("console.detached"), elapsedMs: Date.now() - base.startedAt });
        return true;
      }
      this.db = reply.db;
      const lines = isRawCommand(tokens) ? formatRaw(reply.value) : formatReply(reply.value);
      this.patch(block.id, { state: "done", kind: "reply", lines, elapsedMs: reply.elapsedMs });
    } catch (err) {
      if (detached) return true;
      const apiErr = err instanceof ApiError ? err : new ApiError("internal", String(err));
      const elapsedMs = Date.now() - base.startedAt;
      if (apiErr.kind === "readOnly") this.patch(block.id, { state: "done", kind: "readOnly", message: apiErr.message, elapsedMs });
      else if (apiErr.kind === "cancelled") this.patch(block.id, { state: "cancelled", kind: "declined", message: "", elapsedMs });
      else {
        this.patch(block.id, { state: "done", kind: "failed", message: `${t(`common.errors.${apiErr.kind}`)}: ${apiErr.message}`, elapsedMs });
        ws.handleError(apiErr, false);
      }
    } finally {
      this.detach = null;
    }
    return true;
  }
}

async function confirmDanger(reason: DangerReason, line: string, requireText: string, dbSize: number): Promise<boolean> {
  const message = [t(`console.danger.${reason}`, { count: dbSize }), requireText ? t("console.danger.production") : ""].filter(Boolean).join("\n\n");
  return confirm({
    title: t("console.danger.title"),
    message,
    details: [line],
    danger: true,
    confirmLabel: t("console.danger.run"),
    requireText: requireText || undefined,
  });
}

const GROUPS: readonly CommandGroup[] = ["generic", "string", "hash", "list", "set", "zset", "stream", "geo", "hll", "bitmap", "pubsub", "transactions", "scripting", "connection", "server", "cluster", "json"];

/** redis-cli `help` benzeri yerel yardım */
export function helpLines(args: string[]): FLine[] {
  if (args.length === 0) {
    const usage = [
      [`help <${t("console.help.commandArg")}>`, t("console.help.usageCommand")],
      [`help @<${t("console.help.groupArg")}>`, t("console.help.usageGroup")],
      ["clear", t("console.help.usageClear")],
    ];
    const width = Math.max(...usage.map(([syntax]) => syntax.length)) + 3;
    return textLines(
      [t("console.help.intro"), "", ...usage.map(([syntax, text]) => `  ${syntax.padEnd(width)}${text}`), "", `${t("console.help.groups")}: ${GROUPS.map((g) => `@${g}`).join(" ")}`].join("\n"),
    );
  }
  const first = args[0];
  if (first.startsWith("@")) {
    const group = first.slice(1).toLowerCase();
    const list = COMMANDS.filter((c) => c.group === group);
    if (!list.length) return textLines(t("console.help.unknownGroup", { group: first }), "err");
    return textLines(list.map((c) => `${c.name} ${c.args}`.trimEnd()).join("\n"));
  }
  const found = lookupCommand(args);
  if (found) {
    const { spec } = found;
    return textLines([`  ${spec.name} ${spec.args}`.trimEnd(), `  ${t("console.help.summary")}: ${spec.summary}`, `  ${t("console.help.group")}: ${spec.group}`].join("\n"));
  }
  const upper = first.toUpperCase();
  if (CONTAINERS.has(upper)) {
    return textLines(COMMANDS.filter((c) => c.name.startsWith(`${upper} `)).map((c) => `  ${c.name} ${c.args}`.trimEnd()).join("\n"));
  }
  return textLines(t("console.help.unknown", { command: first }), "err");
}

const sessions = new Map<string, ConsoleSession>();

export function consoleSession(connectionId: string, db: number): ConsoleSession {
  let session = sessions.get(connectionId);
  if (!session) {
    session = new ConsoleSession(connectionId, db);
    sessions.set(connectionId, session);
  }
  return session;
}

export function dropConsoleSession(connectionId: string): void {
  sessions.get(connectionId)?.cancel();
  sessions.delete(connectionId);
}

/** Başka sekmeden (yavaş sorgular) konsola komut taşır */
export function prefillConsole(connectionId: string, db: number, line: string): void {
  consoleSession(connectionId, db).draft = line;
}
