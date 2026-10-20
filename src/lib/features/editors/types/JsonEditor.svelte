<script lang="ts">
  // ReJSON-RL: JSON.GET ile okunur, JSON.SET $ ile yazılır. Biçim sabit (JSON), kayıtta küçültülür.
  import { api, ApiError } from "$lib/api";
  import { toBytes } from "$lib/api/bytes";
  import type { RBytes } from "$lib/api/types";
  import { t } from "$lib/i18n/index.svelte";
  import Spinner from "$lib/ui/Spinner.svelte";
  import type { EditorContext } from "../context";
  import { describeError } from "../messages";
  import ValueEditor from "../value/ValueEditor.svelte";

  let { ctx }: { ctx: EditorContext } = $props();

  let value = $state<string | null>(null);
  let error = $state<string | null>(null);

  async function load() {
    error = null;
    try {
      value = await api.json.get(ctx.ws.connectionId, ctx.ws.db, ctx.key);
    } catch (err) {
      if (err instanceof ApiError && err.kind === "notFound") ctx.ongone();
      else {
        error = describeError(err);
        ctx.ws.handleError(err, false);
      }
    }
  }

  void load();

  async function save(next: RBytes) {
    const text = typeof next === "string" ? next : new TextDecoder().decode(toBytes(next));
    await api.json.set(ctx.ws.connectionId, ctx.ws.db, ctx.key, text);
    value = text;
  }
</script>

{#if value !== null}
  <ValueEditor {value} readOnly={ctx.readOnly} onsave={save} draftKey={`${ctx.scope}#json`} lockedFormat="json" alwaysMinify />
{:else if error}
  <div class="state">
    <div class="title">{t("editors.loadFailed")}</div>
    <p class="selectable">{error}</p>
    <button class="btn" onclick={load}>{t("common.retry")}</button>
  </div>
{:else}
  <div class="state"><Spinner size={16} /></div>
{/if}

<style>
  .state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    flex: 1;
    padding: 24px;
    color: var(--text-3);
    text-align: center;
  }

  .title {
    color: var(--text);
    font-weight: 600;
  }
</style>
