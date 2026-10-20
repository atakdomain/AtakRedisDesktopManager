<script lang="ts">
  // Anahtar başlığı: tür, tam ad (seçilebilir, kopyala, yerinde yeniden adlandır), TTL, üst bilgi, yenile, sil.
  import Copy from "@lucide/svelte/icons/copy";
  import Lock from "@lucide/svelte/icons/lock";
  import Pencil from "@lucide/svelte/icons/pencil";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import { tick } from "svelte";
  import { isBinary, label } from "$lib/api/bytes";
  import type { KeyInfo, KeyType, RBytes } from "$lib/api/types";
  import { t } from "$lib/i18n/index.svelte";
  import { toast, toastError } from "$lib/state/toasts.svelte";
  import Spinner from "$lib/ui/Spinner.svelte";
  import TypeBadge from "$lib/ui/TypeBadge.svelte";
  import { tooltip } from "$lib/ui/tooltip.svelte";
  import { copyText } from "$lib/util/clipboard";
  import { fmtBytes } from "$lib/util/format";
  import TtlControl from "./TtlControl.svelte";

  interface Props {
    keyName: RBytes;
    type: KeyType | undefined;
    info: KeyInfo | null;
    length: number | null;
    ttl: number | null;
    readOnly: boolean;
    gone: boolean;
    refreshing: boolean;
    /** Yeni ad metni (ikili anahtarda \xNN kaçışlı); başarılıysa true */
    onrename: (text: string) => Promise<boolean>;
    onttl: (ms: number) => Promise<boolean>;
    onexpired: () => void;
    onrefresh: () => void;
    ondelete: () => void;
  }

  let { keyName, type, info, length, ttl, readOnly, gone, refreshing, onrename, onttl, onexpired, onrefresh, ondelete }: Props = $props();

  const name = $derived(label(keyName));
  const binary = $derived(isBinary(keyName));

  let renaming = $state(false);
  let draft = $state("");
  let input = $state<HTMLInputElement>();
  let ttlControl = $state<TtlControl>();
  let committing = false;

  export function startRename(): void {
    if (readOnly || gone) return;
    draft = name;
    renaming = true;
    void tick().then(() => {
      input?.focus();
      input?.select();
    });
  }

  export function openTtl(): void {
    ttlControl?.openEditor();
  }

  async function commit() {
    if (committing) return;
    const text = draft;
    if (!text || text === name) {
      renaming = false;
      return;
    }
    committing = true;
    const ok = await onrename(text);
    committing = false;
    if (ok) renaming = false;
    else void tick().then(() => input?.focus());
  }

  function onNameClick() {
    // Metin seçiliyorsa (kopyalamak için) yeniden adlandırmaya geçme
    if (window.getSelection()?.toString()) return;
    startRename();
  }

  async function copyName() {
    try {
      await copyText(name);
      toast("success", t("common.copied"), { timeout: 1500 });
    } catch (err) {
      toastError(err);
    }
  }

  const lengthText = $derived.by(() => {
    if (length === null || !type) return null;
    switch (type) {
      case "string":
        return fmtBytes(length);
      case "hash":
        return t("editors.meta.fields", { count: length });
      case "list":
        return t("editors.meta.items", { count: length });
      case "set":
      case "zset":
        return t("editors.meta.members", { count: length });
      case "stream":
        return t("editors.meta.entries", { count: length });
      default:
        return null;
    }
  });
</script>

<header class="head">
  <div class="line">
    <TypeBadge {type} />
    {#if renaming}
      <input
        bind:this={input}
        class="input sm mono rename"
        bind:value={draft}
        spellcheck="false"
        autocomplete="off"
        aria-label={t("editors.key.renameLabel")}
        onkeydown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            renaming = false;
          }
        }}
        onblur={() => void commit()}
      />
    {:else}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <span class="name mono selectable" class:editable={!readOnly && !gone} onclick={onNameClick} title={readOnly ? name : t("editors.key.clickToRename")}>{name}</span>
      {#if binary}<span class="chip" use:tooltip={t("editors.key.binaryHint")}>{t("editors.key.binary")}</span>{/if}
      <button class="btn ghost icon sm" onclick={copyName} use:tooltip={t("editors.key.copyName")} aria-label={t("editors.key.copyName")}><Copy size={14} /></button>
      {#if !readOnly && !gone}
        <button class="btn ghost icon sm" onclick={startRename} use:tooltip={{ text: t("common.rename"), shortcut: "F2" }} aria-label={t("common.rename")}><Pencil size={14} /></button>
      {/if}
    {/if}
    <span class="grow"></span>
    <button class="btn ghost icon sm" onclick={onrefresh} disabled={refreshing} use:tooltip={{ text: t("common.refresh"), shortcut: "F5" }} aria-label={t("common.refresh")}>
      {#if refreshing}<Spinner size={13} />{:else}<RefreshCw size={14} />{/if}
    </button>
    {#if !readOnly && !gone}
      <button class="btn ghost icon sm delete" onclick={ondelete} use:tooltip={t("editors.key.delete")} aria-label={t("editors.key.delete")}><Trash2 size={14} /></button>
    {/if}
  </div>

  {#if !gone}
    <div class="meta">
      <TtlControl bind:this={ttlControl} {ttl} {readOnly} onapply={onttl} {onexpired} />
      {#if lengthText}<span class="item tabular">{lengthText}</span>{/if}
      {#if info?.memory != null}<span class="item tabular" use:tooltip={t("editors.meta.memoryHint")}>{t("editors.meta.memory", { size: fmtBytes(info.memory) })}</span>{/if}
      {#if info?.encoding}<span class="item" use:tooltip={t("editors.meta.encodingHint")}>{info.encoding}</span>{/if}
      {#if info === null}<Spinner size={11} />{/if}
      {#if readOnly}
        <span class="lock" use:tooltip={t("editors.readOnlyHint")}><Lock size={11} /> {t("common.readOnly")}</span>
      {/if}
    </div>
  {/if}
</header>

<style>
  .head {
    flex: none;
    padding: 8px 10px 7px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
  }

  .line {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 26px;
  }

  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--fs-md);
    font-weight: 500;
    padding: 1px 4px;
    margin-left: 2px;
    border-radius: var(--radius-sm);
  }

  .name.editable {
    cursor: text;
  }

  .name.editable:hover {
    background: var(--bg-hover);
  }

  .rename {
    flex: 1;
    font-size: var(--fs-md);
    height: 26px;
  }

  .chip {
    flex: none;
    padding: 0 6px;
    height: 16px;
    line-height: 16px;
    border-radius: 4px;
    background: var(--bg-active);
    color: var(--text-2);
    font-size: var(--fs-2xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .delete:hover:not(:disabled) {
    color: var(--danger);
    background: var(--danger-soft);
  }

  .meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px 12px;
    margin-top: 5px;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }

  .item {
    white-space: nowrap;
  }

  .lock {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 18px;
    padding: 0 7px;
    border-radius: 999px;
    background: var(--warning-soft);
    color: var(--warning);
    font-weight: 500;
  }
</style>
