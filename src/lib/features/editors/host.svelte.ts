// Bir anahtar düzenleyicisinin ortak durumu: kaydedilmemiş düzenleyicilerin kaydı (Mod+S, sekme kirliliği),
// sekme değişince kaybolmasın diye taslaklar ve anahtar başına küçük görünüm hatırası.
import { getContext, setContext } from "svelte";
import { api } from "$lib/api";
import { bytesId, fromBytes, toBytes } from "$lib/api/bytes";
import type { RBytes } from "$lib/api/types";
import type { Codec, ValueFormat } from "./codec/formats";

export interface Saver {
  dirty(): boolean;
  save(): Promise<unknown>;
  /** Sormadan geri al (yenilemeden önce) */
  discard(): unknown;
}

interface Entry {
  saver: Saver;
  focusedAt: number;
}

export class EditorHost {
  private entries = new Map<symbol, Entry>();
  private dirtyIds = $state.raw(new Set<symbol>());

  get dirty(): boolean {
    return this.dirtyIds.size > 0;
  }

  register(saver: Saver) {
    const id = Symbol();
    this.entries.set(id, { saver, focusedAt: performance.now() });
    return {
      setDirty: (dirty: boolean) => {
        if (dirty === this.dirtyIds.has(id)) return;
        const next = new Set(this.dirtyIds);
        if (dirty) next.add(id);
        else next.delete(id);
        this.dirtyIds = next;
      },
      focused: () => {
        const entry = this.entries.get(id);
        if (entry) entry.focusedAt = performance.now();
      },
      unregister: () => {
        this.entries.delete(id);
        if (this.dirtyIds.has(id)) {
          const next = new Set(this.dirtyIds);
          next.delete(id);
          this.dirtyIds = next;
        }
      },
    };
  }

  /** Yenilemeden önce tüm kaydedilmemiş değişiklikleri at */
  discardAll(): void {
    for (const entry of this.entries.values()) void entry.saver.discard();
  }

  /** Mod+S odak düzenleyici dışındayken: en son odaklanan kirli düzenleyiciyi kaydeder */
  async saveActive(): Promise<void> {
    const candidates = [...this.entries.values()].filter((e) => e.saver.dirty()).sort((a, b) => b.focusedAt - a.focusedAt);
    await candidates[0]?.saver.save();
  }
}

const HOST = Symbol("editor-host");

export function provideHost(host: EditorHost): void {
  setContext(HOST, host);
}

export function useHost(): EditorHost | undefined {
  return getContext<EditorHost | undefined>(HOST);
}

// ───────────── taslaklar ─────────────

export interface Draft {
  /** Taslağın üzerine kurulduğu özgün değer — değer değiştiyse taslak geçersizdir */
  baseId: string;
  format: ValueFormat;
  text: string;
  minify: boolean;
}

const drafts = new Map<string, Draft>();

export function readDraft(key: string, base: RBytes): Draft | undefined {
  const draft = drafts.get(key);
  if (draft && draft.baseId !== bytesId(base)) {
    drafts.delete(key);
    return undefined;
  }
  return draft;
}

export function writeDraft(key: string, draft: Draft): void {
  drafts.set(key, draft);
}

export function dropDraft(key: string): void {
  drafts.delete(key);
}

/** Anahtar kapsamında (scope#…) bekleyen taslak var mı */
export function hasDrafts(scope: string): boolean {
  for (const key of drafts.keys()) if (key === scope || key.startsWith(`${scope}#`)) return true;
  return false;
}

/** Anahtar yeniden adlandırılınca taslaklar ve görünüm hatırası yeni ada taşınır */
export function moveScope(oldScope: string, newScope: string): void {
  for (const map of [drafts, memory, formats] as Map<string, unknown>[]) {
    for (const [key, value] of [...map]) {
      if (key === oldScope || key.startsWith(`${oldScope}#`)) {
        map.delete(key);
        map.set(newScope + key.slice(oldScope.length), value);
      }
    }
  }
}

// ───────────── biçim ve görünüm hatırası ─────────────

const formats = new Map<string, ValueFormat>();

export function rememberedFormat(key: string | undefined): ValueFormat | undefined {
  return key ? formats.get(key) : undefined;
}

export function rememberFormat(key: string | undefined, format: ValueFormat): void {
  if (!key) return;
  if (format === "auto") formats.delete(key);
  else formats.set(key, format);
}

const memory = new Map<string, Record<string, unknown>>();

/** Anahtar başına küçük görünüm durumu (süzgeç, sıralama, seçili satır) — sekme yeniden açılınca geri gelir */
export function viewMemory<T extends Record<string, unknown>>(scope: string, defaults: T): T {
  const stored = memory.get(scope) as Partial<T> | undefined;
  return { ...defaults, ...stored };
}

export function saveViewMemory(scope: string, value: Record<string, unknown>): void {
  memory.set(scope, value);
}

// ───────────── yerleşim ─────────────

/** Oturum boyunca korunan bölme ölçüleri */
export const editorLayout = $state({ detail: 300, field: 240, groups: 280 });

// ───────────── sıkıştırma (arka uç) ─────────────

export const apiCodec: Codec = {
  decode: async (data, format) => toBytes(await api.codec.decode(fromBytes(data), format)),
  encode: async (data, format) => toBytes(await api.codec.encode(fromBytes(data), format)),
};
