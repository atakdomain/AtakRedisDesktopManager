<script lang="ts">
  // CONFIG GET * — süzülebilir liste; değer satırında düzenlenir, onaydan sonra CONFIG SET.
  import Check from "@lucide/svelte/icons/check";
  import Lock from "@lucide/svelte/icons/lock";
  import Pencil from "@lucide/svelte/icons/pencil";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Search from "@lucide/svelte/icons/search";
  import X from "@lucide/svelte/icons/x";
  import { tick, untrack } from "svelte";
  import { api, ApiError } from "$lib/api";
  import type { ConfigItem } from "$lib/api/types";
  import { quoteArg } from "$lib/features/console/parse";
  import { t } from "$lib/i18n/index.svelte";
  import { connections } from "$lib/state/connections.svelte";
  import { confirm } from "$lib/state/dialogs.svelte";
  import { toast, toastError } from "$lib/state/toasts.svelte";
  import type { Workspace } from "$lib/state/workspace.svelte";
  import Spinner from "$lib/ui/Spinner.svelte";
  import { tooltip } from "$lib/ui/tooltip.svelte";
  import { splitMatch } from "./util";

  let { ws, node }: { ws: Workspace; node: string } = $props();

  let items = $state.raw<ConfigItem[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let filter = $state("");
  let editing = $state<string | null>(null);
  let draft = $state("");
  let saving = $state(false);
  let editInput = $state<HTMLInputElement>();

  const q = $derived(filter.trim());
  const shown = $derived(q ? items.filter((x) => x.name.toLowerCase().includes(q.toLowerCase()) || x.value.toLowerCase().includes(q.toLowerCase())) : items);
  const readOnly = $derived(ws.readOnly);

  async function load() {
    loading = true;
    const requested = node;
    try {
      const result = await api.server.config(ws.connectionId, requested, "*");
      if (requested !== node) return;
      items = [...result].sort((a, b) => a.name.localeCompare(b.name));
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      ws.handleError(err, false);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void node;
    untrack(() => void load());
  });

  function startEdit(item: ConfigItem) {
    if (readOnly) return;
    editing = item.name;
    draft = item.value;
    void tick().then(() => editInput?.select());
  }

  async function save(item: ConfigItem) {
    if (saving) return;
    if (draft === item.value) {
      editing = null;
      return;
    }
    const conn = connections.byId(ws.connectionId);
    const production = conn?.env === "production";
    const ok = await confirm({
      title: t("server.config.confirmTitle"),
      message: t("server.config.confirmText", { name: item.name }) + (production ? `\n\n${t("console.danger.production")}` : ""),
      details: [`CONFIG SET ${item.name} ${quoteArg(draft)}`, `${t("server.config.was")}: ${item.value || '""'}`],
      danger: true,
      confirmLabel: t("server.config.apply"),
      requireText: production ? conn?.name || conn?.host : undefined,
    });
    if (!ok) return;
    saving = true;
    try {
      await api.server.configSet(ws.connectionId, node, item.name, draft);
      toast("success", t("server.config.saved", { name: item.name }));
      editing = null;
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.kind === "readOnly") toast("warning", t("common.readOnlyBlocked"));
      else toastError(err);
    } finally {
      saving = false;
    }
  }

  function onkeydown(e: KeyboardEvent, item: ConfigItem) {
    if (e.key === "Enter") {
      e.preventDefault();
      void save(item);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      editing = null;
    }
  }
</script>

{#snippet hl(text: string)}
  {@const parts = splitMatch(text, q)}
  {#if parts}{parts[0]}<mark class="hl">{parts[1]}</mark>{parts[2]}{:else}{text}{/if}
{/snippet}

<div class="tools">
  <label class="search">
    <Search size={13} />
    <input bind:value={filter} placeholder={t("server.config.filter")} spellcheck="false" autocomplete="off" />
  </label>
  <span class="muted count tabular">{t("server.config.count", { count: shown.length })}</span>
  {#if readOnly}<span class="ro"><Lock size={12} /> {t("server.config.readOnly")}</span>{/if}
  <span class="grow"></span>
  <button class="btn ghost icon sm" aria-label={t("common.refresh")} use:tooltip={t("common.refresh")} onclick={() => void load()}>
    {#if loading}<Spinner size={13} />{:else}<RefreshCw size={14} />{/if}
  </button>
</div>

{#if error && !items.length}
  <p class="msg error-text">{error}</p>
{:else if !items.length && loading}
  <div class="msg"><Spinner size={16} /></div>
{:else if !shown.length}
  <p class="msg muted">{t("common.noResults")}</p>
{:else}
  <div class="list">
    {#each shown as item (item.name)}
      <div class="row" class:editing={editing === item.name}>
        <span class="name mono">{@render hl(item.name)}</span>
        {#if editing === item.name}
          <input class="input sm mono" bind:this={editInput} bind:value={draft} spellcheck="false" autocomplete="off" disabled={saving} onkeydown={(e) => onkeydown(e, item)} aria-label={item.name} />
          <span class="acts">
            <button class="btn ghost icon sm" aria-label={t("common.save")} use:tooltip={{ text: t("common.save"), shortcut: "Enter" }} disabled={saving} onclick={() => void save(item)}><Check size={14} /></button>
            <button class="btn ghost icon sm" aria-label={t("common.cancel")} use:tooltip={{ text: t("common.cancel"), shortcut: "Escape" }} onclick={() => (editing = null)}><X size={14} /></button>
          </span>
        {:else}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <span class="value mono selectable" class:empty={!item.value} ondblclick={() => startEdit(item)}>{#if item.value}{@render hl(item.value)}{:else}""{/if}</span>
          <span class="acts">
            {#if !readOnly}
              <button class="btn ghost icon sm edit" aria-label={t("common.edit")} use:tooltip={t("common.edit")} onclick={() => startEdit(item)}><Pencil size={13} /></button>
            {/if}
          </span>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .tools {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px 6px;
  }

  .search {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 280px;
    height: var(--h-control-sm);
    padding: 0 8px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--bg-input);
    color: var(--text-3);
  }

  .search:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: none;
    outline: none;
    color: var(--text);
    font-size: var(--fs-sm);
  }

  .count {
    font-size: var(--fs-xs);
  }

  .ro {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--warning);
    font-size: var(--fs-xs);
  }

  .msg {
    display: flex;
    justify-content: center;
    padding: 18px 12px;
    font-size: var(--fs-sm);
  }

  .list {
    padding: 0 6px 8px;
  }

  .row {
    display: grid;
    grid-template-columns: minmax(160px, 34%) minmax(0, 1fr) 56px;
    align-items: center;
    gap: 12px;
    min-height: 28px;
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    font-size: var(--fs-xs);
  }

  .row:hover,
  .row.editing {
    background: var(--bg-hover);
  }

  .name {
    color: var(--text-2);
    font-size: var(--fs-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .value {
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: var(--fs-xs);
  }

  .value.empty {
    color: var(--text-3);
  }

  .acts {
    display: flex;
    justify-content: flex-end;
    gap: 2px;
  }

  .edit {
    opacity: 0;
  }

  .row:hover .edit,
  .edit:focus-visible {
    opacity: 1;
  }
</style>
