<script lang="ts">
  // CLIENT LIST tablosu: süzgeç, sütuna göre sıralama, sanal satırlar.
  import ArrowDown from "@lucide/svelte/icons/arrow-down";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Search from "@lucide/svelte/icons/search";
  import { untrack } from "svelte";
  import { api } from "$lib/api";
  import { t } from "$lib/i18n/index.svelte";
  import type { Workspace } from "$lib/state/workspace.svelte";
  import Spinner from "$lib/ui/Spinner.svelte";
  import VirtualList from "$lib/ui/VirtualList.svelte";
  import { tooltip } from "$lib/ui/tooltip.svelte";
  import { parseClientList, type ClientInfo } from "./clients";
  import { fmtUptime } from "./util";

  let { ws, node }: { ws: Workspace; node: string } = $props();

  type Col = "id" | "addr" | "name" | "age" | "idle" | "db" | "cmd" | "flags" | "user";
  const ROW = 26;

  let clients = $state.raw<ClientInfo[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let filter = $state("");
  let sortBy = $state<Col>("id");
  let desc = $state(false);

  const columns = $derived<{ key: Col; label: string; numeric?: boolean }[]>([
    { key: "id", label: "ID", numeric: true },
    { key: "addr", label: t("server.clientList.addr") },
    { key: "name", label: t("server.clientList.name") },
    { key: "age", label: t("server.clientList.age"), numeric: true },
    { key: "idle", label: t("server.clientList.idle"), numeric: true },
    { key: "db", label: "DB", numeric: true },
    { key: "cmd", label: t("server.clientList.cmd") },
    { key: "flags", label: t("server.clientList.flags") },
    { key: "user", label: t("server.clientList.user") },
  ]);

  const shown = $derived.by(() => {
    const q = filter.trim().toLowerCase();
    const list = q ? clients.filter((c) => `${c.id} ${c.addr} ${c.name} ${c.cmd} ${c.user} ${c.flags}`.toLowerCase().includes(q)) : [...clients];
    const key = sortBy;
    const dir = desc ? -1 : 1;
    return list.sort((a, b) => {
      const x = a[key];
      const y = b[key];
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * dir;
    });
  });

  async function load() {
    loading = true;
    const requested = node;
    try {
      const text = await api.server.clients(ws.connectionId, requested);
      if (requested !== node) return;
      clients = parseClientList(text);
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

  function sort(col: Col) {
    if (sortBy === col) desc = !desc;
    else {
      sortBy = col;
      desc = col === "age" || col === "idle";
    }
  }
</script>

{#snippet row(index: number)}
  {@const c = shown[index]}
  {#if c}
    <div class="tr">
      <span class="num">{c.id}</span>
      <span class="mono truncate selectable">{c.addr}</span>
      <span class="truncate" class:muted={!c.name}>{c.name || "—"}</span>
      <span class="num">{fmtUptime(c.age)}</span>
      <span class="num">{fmtUptime(c.idle)}</span>
      <span class="num">{c.db}</span>
      <span class="mono truncate">{c.cmd}</span>
      <span class="mono truncate">{c.flags}</span>
      <span class="truncate">{c.user}</span>
    </div>
  {/if}
{/snippet}

<div class="tools">
  <label class="search">
    <Search size={13} />
    <input bind:value={filter} placeholder={t("server.clientList.filter")} spellcheck="false" autocomplete="off" />
  </label>
  <span class="muted count tabular">{t("server.clientList.count", { count: shown.length })}</span>
  <span class="grow"></span>
  <button class="btn ghost icon sm" aria-label={t("common.refresh")} use:tooltip={t("common.refresh")} onclick={() => void load()}>
    {#if loading}<Spinner size={13} />{:else}<RefreshCw size={14} />{/if}
  </button>
</div>

{#if error && !clients.length}
  <p class="msg error-text">{error}</p>
{:else}
  <div class="table">
    <div class="tr th">
      {#each columns as col (col.key)}
        <button class:num={col.numeric} class:active={sortBy === col.key} onclick={() => sort(col.key)}>
          <span>{col.label}</span>
          {#if sortBy === col.key}{#if desc}<ArrowDown size={11} />{:else}<ArrowUp size={11} />{/if}{/if}
        </button>
      {/each}
    </div>
    <div class="body" style:height="{Math.min(Math.max(shown.length, 3), 16) * ROW}px">
      <VirtualList count={shown.length} rowHeight={ROW} {row}>
        {#snippet empty()}
          <p class="msg muted">{loading ? t("common.loading") : t("common.noResults")}</p>
        {/snippet}
      </VirtualList>
    </div>
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

  .msg {
    padding: 18px 12px;
    text-align: center;
    font-size: var(--fs-sm);
  }

  .table {
    padding: 0 6px 8px;
    overflow-x: auto;
  }

  .tr {
    display: grid;
    grid-template-columns: 56px minmax(140px, 1.3fr) minmax(80px, 1fr) 90px 90px 40px minmax(90px, 1fr) 70px minmax(60px, 0.8fr);
    align-items: center;
    gap: 10px;
    min-width: 860px;
    height: 26px;
    padding: 0 6px;
    border-bottom: 1px solid var(--border-subtle);
    font-size: var(--fs-xs);
  }

  .tr:not(.th):hover {
    background: var(--bg-hover);
  }

  .th {
    border-bottom-color: var(--border);
  }

  .th button {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    min-width: 0;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-3);
    font-size: var(--fs-xs);
    font-weight: 600;
    cursor: pointer;
  }

  .th button.num {
    justify-content: flex-end;
  }

  .th button.active,
  .th button:hover {
    color: var(--text);
  }

  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .body {
    min-width: 860px;
  }
</style>
