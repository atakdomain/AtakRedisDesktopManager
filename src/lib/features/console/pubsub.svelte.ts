// Bağlantı başına Pub/Sub + MONITOR durumu. Mesajlar karede bir toplu eklenir, en fazla MAX_ENTRIES tutulur.
// Abonelikler sekme bileşeninin ömrüne bağlıdır (bileşen kaldırılınca durur); liste ve hedefler korunur.
import { api } from "$lib/api";
import { byteLength, label } from "$lib/api/bytes";
import type { PubSubMessage, RBytes } from "$lib/api/types";
import { toastError } from "$lib/state/toasts.svelte";
import { uid } from "$lib/util/id";
import type { StreamRequest } from "./session.svelte";

export const MAX_ENTRIES = 10_000;
const PREVIEW_CHARS = 400;

export interface Target {
  text: string;
  /** PSUBSCRIBE deseni mi, düz kanal mı */
  pattern: boolean;
}

export interface Entry {
  id: number;
  /** Unix ms */
  at: number;
  source: "message" | "monitor";
  /** Kanal adı; MONITOR'de istemci adresi */
  channel: string;
  pattern: string;
  payload: RBytes;
  preview: string;
  size: number;
  /** MONITOR satırının veritabanı */
  db: number | null;
  /** Süzgeç için küçük harf metin */
  search: string;
}

export function isGlob(text: string): boolean {
  return /[*?[]/.test(text);
}

/** `1339518083.107412 [0 127.0.0.1:60866] "keys" "*"` → parçalar; tanınmazsa null */
export function parseMonitorLine(line: string): { at: number; db: number; client: string; command: string } | null {
  const m = /^(\d+(?:\.\d+)?) \[(\d+) ([^\]]*)\] ?(.*)$/.exec(line);
  if (!m) return null;
  return { at: Math.round(Number(m[1]) * 1000), db: Number(m[2]), client: m[3], command: m[4] };
}

function previewOf(text: string): string {
  const short = text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text;
  return short.replace(/[\r\n\t]+/g, " ");
}

export class PubSubState {
  readonly connectionId: string;

  targets = $state<Target[]>([]);
  subscribed = $state(false);
  monitoring = $state(false);
  monitorNode = $state("");
  paused = $state(false);
  autoScroll = $state(true);
  filter = $state("");
  selectedId = $state<number | null>(null);
  publishChannel = $state("");
  publishMessage = $state("");
  /** Konsoldan gelen istek: sekme açılınca başlatılır */
  pending = $state<StreamRequest | null>(null);
  /** Görünen liste (duraklatılınca donar) */
  entries = $state.raw<Entry[]>([]);
  /** Duraklatılmışken gelen mesaj sayısı */
  pausedNew = $state(0);
  received = $state(0);

  private all: Entry[] = [];
  private queue: Entry[] = [];
  private frame = 0;
  private nextId = 1;
  private subId: string | null = null;
  private monitorId: string | null = null;

  constructor(connectionId: string) {
    this.connectionId = connectionId;
  }

  get channels(): string[] {
    return this.targets.filter((x) => !x.pattern).map((x) => x.text);
  }

  get patterns(): string[] {
    return this.targets.filter((x) => x.pattern).map((x) => x.text);
  }

  find(id: number | null): Entry | undefined {
    if (id === null) return undefined;
    return this.all.find((e) => e.id === id) ?? this.entries.find((e) => e.id === id);
  }

  addTargets(texts: string[], pattern?: boolean): boolean {
    let added = false;
    for (const raw of texts) {
      const text = raw.trim();
      if (!text || this.targets.some((x) => x.text === text)) continue;
      this.targets.push({ text, pattern: pattern ?? isGlob(text) });
      added = true;
    }
    return added;
  }

  private push(entry: Entry): void {
    this.queue.push(entry);
    this.received++;
    this.frame ||= requestAnimationFrame(() => this.flush());
  }

  private flush(): void {
    this.frame = 0;
    if (!this.queue.length) return;
    const batch = this.queue;
    this.queue = [];
    let next = this.all.concat(batch);
    if (next.length > MAX_ENTRIES) next = next.slice(next.length - MAX_ENTRIES);
    this.all = next;
    if (this.paused) this.pausedNew += batch.length;
    else this.entries = next;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.pausedNew = 0;
    if (!paused) this.entries = this.all;
  }

  clear(): void {
    this.all = [];
    this.queue = [];
    this.entries = [];
    this.pausedNew = 0;
    this.selectedId = null;
  }

  async subscribe(): Promise<void> {
    this.unsubscribe();
    const channels = this.channels;
    const patterns = this.patterns;
    if (!channels.length && !patterns.length) return;
    const subId = uid();
    this.subId = subId;
    this.subscribed = true;
    try {
      await api.console.subscribe(this.connectionId, channels, patterns, subId, (m: PubSubMessage) => {
        if (this.subId !== subId) return;
        const text = label(m.payload);
        const channel = label(m.channel);
        this.push({
          id: this.nextId++,
          at: m.atMs || Date.now(),
          source: "message",
          channel,
          pattern: m.pattern,
          payload: m.payload,
          preview: previewOf(text),
          size: byteLength(m.payload),
          db: null,
          search: `${channel}\n${m.pattern}\n${text.slice(0, 4000)}`.toLowerCase(),
        });
      });
    } catch (err) {
      if (this.subId === subId) toastError(err);
    } finally {
      if (this.subId === subId) {
        this.subId = null;
        this.subscribed = false;
      }
    }
  }

  unsubscribe(): void {
    if (this.subId) void api.console.stop(this.subId).catch(() => undefined);
    this.subId = null;
    this.subscribed = false;
  }

  async startMonitor(): Promise<void> {
    this.stopMonitor();
    const subId = uid();
    this.monitorId = subId;
    this.monitoring = true;
    try {
      await api.console.monitor(this.connectionId, this.monitorNode, subId, (line) => {
        if (this.monitorId !== subId) return;
        const parsed = parseMonitorLine(line);
        const command = parsed?.command ?? line;
        this.push({
          id: this.nextId++,
          at: parsed?.at ?? Date.now(),
          source: "monitor",
          channel: parsed?.client ?? "",
          pattern: "",
          payload: line,
          preview: previewOf(command),
          size: line.length,
          db: parsed?.db ?? null,
          search: line.toLowerCase(),
        });
      });
    } catch (err) {
      if (this.monitorId === subId) toastError(err);
    } finally {
      if (this.monitorId === subId) {
        this.monitorId = null;
        this.monitoring = false;
      }
    }
  }

  stopMonitor(): void {
    if (this.monitorId) void api.console.stop(this.monitorId).catch(() => undefined);
    this.monitorId = null;
    this.monitoring = false;
  }

  stopAll(): void {
    this.unsubscribe();
    this.stopMonitor();
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.flush();
  }
}

const states = new Map<string, PubSubState>();

export function pubsubState(connectionId: string): PubSubState {
  let state = states.get(connectionId);
  if (!state) {
    state = new PubSubState(connectionId);
    states.set(connectionId, state);
  }
  return state;
}

export function dropPubsubState(connectionId: string): void {
  states.get(connectionId)?.stopAll();
  states.delete(connectionId);
}

/** Konsolda yazılan SUBSCRIBE/PSUBSCRIBE/MONITOR'ü Pub/Sub sekmesine aktarır */
export function requestStream(connectionId: string, request: StreamRequest): void {
  const state = pubsubState(connectionId);
  state.addTargets(request.channels, false);
  state.addTargets(request.patterns, true);
  state.pending = request;
}
