<script lang="ts">
  import Copy from "@lucide/svelte/icons/copy";
  import Gauge from "@lucide/svelte/icons/gauge";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Search from "@lucide/svelte/icons/search";
  import SquareTerminal from "@lucide/svelte/icons/square-terminal";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import { untrack } from "svelte";
  import { api, ApiError } from "$lib/api";
  import { label } from "$lib/api/bytes";
  import type { SlowlogEntry } from "$lib/api/types";
  import { quoteArg } from "$lib/features/console/parse";
  import { prefillConsole } from "$lib/features/console/session.svelte";
  import { openToolTab } from "$lib/features/shell/tools";
  import { fmtNumber, t } from "$lib/i18n/index.svelte";
  import { connections } from "$lib/state/connections.svelte";
  import { confirm } from "$lib/state/dialogs.svelte";
  import { openContextMenu } from "$lib/state/menu.svelte";
  import { toast, toastError } from "$lib/state/toasts.svelte";
  import type { Workspace } from "$lib/state/workspace.svelte";
  import EmptyState from "$lib/ui/EmptyState.svelte";
  import Segmented from "$lib/ui/Segmented.svelte";
  import Spinner from "$lib/ui/Spinner.svelte";
  import VirtualList from "$lib/ui/VirtualList.svelte";
  import { tooltip } from "$lib/ui/tooltip.svelte";
  import { copyText } from "$lib/util/clipboard";
  import NodeSelect from "./NodeSelect.svelte";
  import { durationTone } from "./util";

  let { ws }: { ws: Workspace } = $props();

  const ROW = 28;
  /** İpucunda gösterilen en uzun komut metni */
  const TIP_MAX = 600;

  interface Row {
    entry: SlowlogEntry;
    command: string;
    search: string;
  }

  let node = $state("");
  let count = $state(128);
  let rows = $state.raw<Row[]>([]);
  let loading = $state(false);
  let error = $state<ApiError | null>(null);
  let filter = $state("");
  let selected = $state<number | null>(null);
  let loadedAt = 0;

  const visible = $derived(ws.activeTabId === "slowlog");
  const readOnly = $derived(ws.readOnly);
  const shown = $derived.by(() => {
    const q = filter.trim().toLowerCase();
    return q ? rows.filter((r) => r.search.includes(q)) : rows;
  });
  const maxUs = $derived(Math.max(1, ...rows.map((r) => r.entry.durationUs)));
  const totalUs = $derived(rows.reduce((n, r) => n + r.entry.durationUs, 0));

  async function load() {
    loading = true;
    const requested = { node, count };
    try {
      const entries = await api.server.slowlog(ws.connectionId, requested.node, requested.count);
      if (requested.node !== node || requested.count !== count) return;
      rows = entries.map((entry) => {
        const command = entry.args.map((a) => quoteArg(label(a))).join(" ");
        return { entry, command, search: `${command} ${entry.client} ${entry.clientName}`.toLowerCase() };
      });
      error = null;
      loadedAt = Date.now();
    } catch (err) {
      error = err instanceof ApiError ? err : new ApiError("internal", String(err));
      ws.handleError(err, false);
    } finally {
      loading = false;
    }
  }

  // Düğüm/adet değişince ve sekme 10 sn'den uzun gizli kaldıktan sonra görünür olunca yeniler
  $effect(() => {
    void node;
    void count;
    if (!visible) return;
    untrack(() => {
      if (Date.now() - loadedAt > 10_000 || !rows.length) void load();
    });
  });

  function reloadNow() {
    loadedAt = 0;
    void load();
  }

  async function reset() {
    const conn = connections.byId(ws.connectionId);
    const production = conn?.env === "production";
    const ok = await confirm({
      title: t("server.slowlog.resetTitle"),
      message: t("server.slowlog.resetText") + (production ? `\n\n${t("console.danger.production")}` : ""),
      danger: true,
      confirmLabel: t("server.slowlog.reset"),
      requireText: production ? conn?.name || conn?.host : undefined,
    });
    if (!ok) return;
    try {
      await api.server.slowlogReset(ws.connectionId, node);
      toast("success", t("server.slowlog.resetDone"));
      reloadNow();
    } catch (err) {
      if (err instanceof ApiError && err.kind === "readOnly") toast("warning", t("common.readOnlyBlocked"));
      else toastError(err);
    }
  }

  async function copy(text: string) {
    try {
      await copyText(text);
      toast("success", t("common.copied"), { timeout: 1500 });
    } catch (err) {
      toastError(err);
    }
  }

  function toConsole(row: Row) {
    prefillConsole(ws.connectionId, ws.db, row.command);
    openToolTab(ws, "console");
  }

  function menu(e: MouseEvent, row: Row) {
    selected = row.entry.id;
    openContextMenu(e, [
      { label: t("server.slowlog.copyCommand"), icon: Copy, run: () => copy(row.command) },
      { label: t("server.slowlog.toConsole"), icon: SquareTerminal, run: () => toConsole(row) },
      { kind: "separator" },
      { label: t("server.slowlog.copyClient"), disabled: !row.entry.client, run: () => copy(row.entry.client) },
    ]);
  }

  function fmtUs(us: number): string {
    if (us < 1000) return `${fmtNumber(us)} µs`;
    if (us < 1_000_000) return `${fmtNumber(Math.round(us / 100) / 10)} ms`;
    return `${fmtNumber(Math.round(us / 10_000) / 100)} s`;
  }

  function fmtTime(unixSec: number): string {
    const d = new Date(unixSec * 1000);
    const today = new Date();
    return d.toDateString() === today.toDateString() ? d.toLocaleTimeString() : d.toLocaleString();
  }

  function onkeydown(e: KeyboardEvent) {
    if (!shown.length) return;
    let index = shown.findIndex((r) => r.entry.id === selected);
    if (e.key === "ArrowDown") index = Math.min(shown.length - 1, index + 1);
    else if (e.key === "ArrowUp") index = Math.max(0, index - 1);
    else if (e.key === "Enter" && index >= 0) {
      toConsole(shown[index]);
      return;
    } else if ((e.key === "c" || e.key === "C") && (e.ctrlKey || e.metaKey) && index >= 0) {
      void copy(shown[index].command);
      e.preventDefault();
      return;
    } else return;
    e.preventDefault();
    selected = shown[index].entry.id;
    list?.scrollToIndex(index);
  }

  let list = $state<ReturnType<typeof VirtualList>>();
</script>

{#snippet row(index: number)}
  {#if shown[index]}
    {@const r = shown[index]}
    {@const e = r.entry}
    {@const tone = durationTone(e.durationUs)}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="tr"
      class:selected={selected === e.id}
      role="row"
      tabindex="-1"
      aria-selected={selected === e.id}
      onclick={() => (selected = e.id)}
      ondblclick={() => toConsole(r)}
      oncontextmenu={(ev) => menu(ev, r)}
    >
      <span class="num muted">{e.id}</span>
      <span class="tabular time truncate" use:tooltip={new Date(e.timestamp * 1000).toLocaleString()}>{fmtTime(e.timestamp)}</span>
      <span class="dur {tone}">
        <span class="bar"><span style:width="{Math.max(3, Math.sqrt(e.durationUs / maxUs) * 100)}%"></span></span>
        <span class="tabular val">{fmtUs(e.durationUs)}</span>
      </span>
      <span class="cmd mono" use:tooltip={r.command.length > 60 ? r.command.slice(0, TIP_MAX) + (r.command.length > TIP_MAX ? "…" : "") : undefined}>
        <span class="truncate"><b>{r.command.split(" ", 1)[0]}</b>{r.command.slice(r.command.split(" ", 1)[0].length)}</span>
        <button class="copy" aria-label={t("server.slowlog.copyCommand")} onclick={(ev) => {
          ev.stopPropagation();
          void copy(r.command);
        }}><Copy size={12} /></button>
      </span>
      <span class="client truncate">
        <span class="mono">{e.client || "—"}</span>
        {#if e.clientName}<span class="cname">{e.clientName}</span>{/if}
      </span>
    </div>
  {/if}
{/snippet}

<div class="slowlog">
  <div class="toolbar">
    <NodeSelect connectionId={ws.connectionId} bind:value={node} onchange={() => (loadedAt = 0)} />
    <Segmented
      size="sm"
      bind:value={count}
      onchange={() => (loadedAt = 0)}
      options={[
        { value: 50, label: "50" },
        { value: 128, label: "128" },
        { value: 500, label: "500" },
      ]}
    />
    <label class="search">
      <Search size={13} />
      <input bind:value={filter} placeholder={t("server.slowlog.filter")} spellcheck="false" autocomplete="off" />
    </label>
    <span class="muted summary tabular">
      {t("server.slowlog.summary", { count: shown.length })}{#if rows.length} · {t("server.slowlog.total", { time: fmtUs(totalUs) })}{/if}
    </span>
    <span class="grow"></span>
    <button class="btn ghost icon sm" aria-label={t("common.refresh")} use:tooltip={t("common.refresh")} onclick={reloadNow}>
      {#if loading}<Spinner size={13} />{:else}<RefreshCw size={14} />{/if}
    </button>
    <button class="btn ghost sm" disabled={readOnly || !rows.length} use:tooltip={readOnly ? t("common.readOnlyBlocked") : undefined} onclick={() => void reset()}>
      <Trash2 size={13} /> {t("server.slowlog.reset")}
    </button>
  </div>

  <div class="thead">
    <span class="num">ID</span>
    <span>{t("server.slowlog.colTime")}</span>
    <span>{t("server.slowlog.colDuration")}</span>
    <span>{t("server.slowlog.colCommand")}</span>
    <span>{t("server.slowlog.colClient")}</span>
  </div>

  <div class="body">
    {#if error && !rows.length}
      <EmptyState icon={Gauge} title={t("server.slowlog.loadFailed")} description={error.message}>
        <button class="btn sm" onclick={reloadNow}>{t("common.retry")}</button>
      </EmptyState>
    {:else}
      <VirtualList bind:this={list} count={shown.length} rowHeight={ROW} {row} tabindex={0} role="grid" label={t("shell.tabs.slowlog")} {onkeydown}>
        {#snippet empty()}
          {#if loading}
            <div class="center"><Spinner size={18} /></div>
          {:else}
            <EmptyState icon={Gauge} title={rows.length ? t("common.noResults") : t("server.slowlog.emptyTitle")} description={rows.length ? undefined : t("server.slowlog.emptyText")} />
          {/if}
        {/snippet}
      </VirtualList>
    {/if}
  </div>
</div>

<style>
  .slowlog {
    container: slowlog / inline-size;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--bg);
    font-variant-ligatures: none;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    padding: 7px 8px 7px 12px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .search {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 0 1 220px;
    min-width: 100px;
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

  .summary {
    font-size: var(--fs-xs);
    white-space: nowrap;
  }

  .thead,
  .tr {
    display: grid;
    grid-template-columns: 56px 150px 150px minmax(0, 1fr) minmax(120px, 220px);
    align-items: center;
    gap: 12px;
    padding: 0 12px;
  }

  .thead {
    flex: none;
    height: 28px;
    border-bottom: 1px solid var(--border);
    color: var(--text-3);
    font-size: var(--fs-xs);
    font-weight: 600;
  }

  .body {
    flex: 1;
    min-height: 0;
  }

  .tr {
    height: 28px;
    border-bottom: 1px solid var(--border-subtle);
    font-size: var(--fs-sm);
  }

  .tr:hover {
    background: var(--bg-hover);
  }

  .tr.selected {
    background: var(--bg-selected);
  }

  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .time {
    color: var(--text-2);
    font-size: var(--fs-xs);
  }

  .dur {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .bar {
    flex: none;
    width: 52px;
    height: 5px;
    border-radius: 999px;
    background: var(--bg-active);
    overflow: hidden;
  }

  .bar span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--c);
  }

  .val {
    color: var(--c);
    font-size: var(--fs-xs);
    font-weight: 600;
  }

  .low {
    --c: var(--text-3);
  }

  .mid {
    --c: var(--text);
  }

  .high {
    --c: var(--warning);
  }

  .severe {
    --c: var(--danger);
  }

  .cmd {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    font-size: var(--fs-xs);
  }

  .cmd b {
    font-weight: 700;
  }

  .copy {
    display: grid;
    place-items: center;
    flex: none;
    width: 20px;
    height: 20px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-3);
    cursor: pointer;
    opacity: 0;
  }

  .tr:hover .copy {
    opacity: 1;
  }

  .copy:hover {
    background: var(--bg-active);
    color: var(--text);
  }

  .client {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    color: var(--text-2);
    font-size: var(--fs-xs);
  }

  .cname {
    padding: 0 6px;
    border-radius: 999px;
    background: var(--bg-active);
    color: var(--text-2);
    font-size: var(--fs-2xs);
    line-height: 16px;
  }

  /* Dar sekmede kimlik ve istemci sütunları gizlenir */
  @container slowlog (max-width: 720px) {
    .thead,
    .tr {
      grid-template-columns: 84px 118px minmax(0, 1fr);
      gap: 10px;
    }

    .thead > :nth-child(1),
    .thead > :nth-child(5),
    .tr > .num,
    .tr > .client {
      display: none;
    }

    .summary {
      display: none;
    }
  }

  .center {
    display: grid;
    place-items: center;
    height: 160px;
    color: var(--text-3);
  }
</style>
