<script lang="ts">
  // String: tüm paneli kaplayan değer düzenleyici. 2 MB üstü değerler önce sorulur (salt okunur / düzenle).
  import FileWarning from "@lucide/svelte/icons/file-warning";
  import { api, ApiError } from "$lib/api";
  import { byteLength } from "$lib/api/bytes";
  import type { RBytes } from "$lib/api/types";
  import { t } from "$lib/i18n/index.svelte";
  import Spinner from "$lib/ui/Spinner.svelte";
  import { fmtBytes } from "$lib/util/format";
  import type { EditorContext } from "../context";
  import { describeError } from "../messages";
  import ValueEditor from "../value/ValueEditor.svelte";

  /** `size`: STRLEN (anahtar bilgisinden); null = henüz bilinmiyor, -1 = bilgi alınamadı */
  let { ctx, size }: { ctx: EditorContext; size: number | null } = $props();

  const LARGE = 2 * 1024 * 1024;

  let value = $state.raw<RBytes | null>(null);
  let error = $state<string | null>(null);
  let approved = $state<"view" | "edit" | null>(null);
  let started = false;

  const gated = $derived(size !== null && size > LARGE && approved === null);

  async function load() {
    error = null;
    try {
      const result = await api.string.get(ctx.ws.connectionId, ctx.ws.db, ctx.key);
      value = result.value;
      ctx.onlength(result.size);
    } catch (err) {
      if (err instanceof ApiError && err.kind === "notFound") ctx.ongone();
      else {
        error = describeError(err);
        ctx.ws.handleError(err, false);
      }
    }
  }

  $effect(() => {
    if (started || size === null || gated) return;
    started = true;
    void load();
  });

  async function save(next: RBytes) {
    await api.string.set(ctx.ws.connectionId, ctx.ws.db, ctx.key, next);
    value = next;
    ctx.onlength(byteLength(next));
  }
</script>

{#if gated}
  <div class="gate">
    <FileWarning size={26} strokeWidth={1.6} />
    <div class="title">{t("editors.string.largeTitle", { size: fmtBytes(size ?? 0) })}</div>
    <p>{t("editors.string.largeText")}</p>
    <div class="row">
      <button class="btn primary" onclick={() => (approved = "view")}>{t("editors.string.loadReadOnly")}</button>
      {#if !ctx.readOnly}<button class="btn" onclick={() => (approved = "edit")}>{t("editors.string.loadEdit")}</button>{/if}
    </div>
  </div>
{:else if value !== null}
  <ValueEditor {value} readOnly={ctx.readOnly} onsave={save} draftKey={`${ctx.scope}#value`} largeEditable={approved === "edit"} />
{:else if error}
  <div class="gate">
    <div class="title">{t("editors.loadFailed")}</div>
    <p class="selectable">{error}</p>
    <button class="btn" onclick={load}>{t("common.retry")}</button>
  </div>
{:else}
  <div class="gate"><Spinner size={16} /></div>
{/if}

<style>
  .gate {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    flex: 1;
    padding: 24px;
    text-align: center;
    color: var(--text-3);
  }

  .title {
    color: var(--text);
    font-weight: 600;
    font-size: var(--fs-md);
  }

  p {
    max-width: 420px;
    font-size: var(--fs-sm);
  }

  .row {
    margin-top: 6px;
  }
</style>
