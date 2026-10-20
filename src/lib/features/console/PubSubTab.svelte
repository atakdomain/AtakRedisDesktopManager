<script lang="ts">
  import Activity from "@lucide/svelte/icons/activity";
  import ArrowDownToLine from "@lucide/svelte/icons/arrow-down-to-line";
  import Eraser from "@lucide/svelte/icons/eraser";
  import Pause from "@lucide/svelte/icons/pause";
  import Play from "@lucide/svelte/icons/play";
  import Radio from "@lucide/svelte/icons/radio";
  import Search from "@lucide/svelte/icons/search";
  import Send from "@lucide/svelte/icons/send";
  import Square from "@lucide/svelte/icons/square";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import { tick, untrack } from "svelte";
  import { api, ApiError } from "$lib/api";
  import NodeSelect from "$lib/features/server/NodeSelect.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { connections } from "$lib/state/connections.svelte";
  import { confirm } from "$lib/state/dialogs.svelte";
  import { toast, toastError } from "$lib/state/toasts.svelte";
  import type { Workspace } from "$lib/state/workspace.svelte";
  import EmptyState from "$lib/ui/EmptyState.svelte";
  import Resizer from "$lib/ui/Resizer.svelte";
  import VirtualList from "$lib/ui/VirtualList.svelte";
  import { tooltip } from "$lib/ui/tooltip.svelte";
  import { copyText } from "$lib/util/clipboard";
  import ChipInput from "./ChipInput.svelte";
  import { quoteArg } from "./parse";
  import PayloadView from "./PayloadView.svelte";
  import { dropPubsubState, MAX_ENTRIES, pubsubState } from "./pubsub.svelte";

  let { ws }: { ws: Workspace } = $props();

  const ROW = 26;

  const st = $derived(pubsubState(ws.connectionId));
  const conn = $derived(connections.byId(ws.connectionId));
  const filtered = $derived.by(() => {
    const list = st.entries;
    const q = st.filter.trim().toLowerCase();
    return q ? list.filter((e) => e.search.includes(q)) : list;
  });
  const selected = $derived(st.find(st.selectedId));
  const live = $derived(st.subscribed || st.monitoring);

  let list = $state<ReturnType<typeof VirtualList>>();
  let viewerWidth = $state(380);
  let publishing = $state(false);
  let programmatic = false;

  // Abonelikler bileşenin ömrüne bağlı; sekme kapatılınca durum da atılır
  $effect(() => {
    const state = st;
    const w = ws;
    return () => {
      state.stopAll();
      if (!w.tabs.some((tab) => tab.id === "pubsub")) dropPubsubState(w.connectionId);
    };
  });

  // Konsoldan gelen SUBSCRIBE / MONITOR isteği
  $effect(() => {
    const request = st.pending;
    if (!request) return;
    untrack(() => {
      st.pending = null;
      if (request.monitor) void toggleMonitor(true);
      else if (st.targets.length) void st.subscribe();
    });
  });

  $effect(() => {
    void filtered.length;
    if (!st.autoScroll || st.paused) return;
    void tick().then(() => {
      const el = list?.element();
      if (!el) return;
      programmatic = true;
      el.scrollTop = el.scrollHeight;
    });
  });

  $effect(() => {
    const el = list?.element();
    if (!el) return;
    const onscroll = () => {
      if (programmatic) {
        programmatic = false;
        return;
      }
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < ROW;
      if (!atBottom && st.autoScroll) st.autoScroll = false;
      else if (atBottom && !st.autoScroll && !st.paused) st.autoScroll = true;
    };
    el.addEventListener("scroll", onscroll, { passive: true });
    return () => el.removeEventListener("scroll", onscroll);
  });

  function addTargets(texts: string[]) {
    if (st.addTargets(texts) && st.subscribed) void st.subscribe();
  }

  function removeTarget(index: number) {
    st.targets.splice(index, 1);
    if (!st.subscribed) return;
    if (st.targets.length) void st.subscribe();
    else st.unsubscribe();
  }

  function toggleKind(index: number) {
    st.targets[index].pattern = !st.targets[index].pattern;
    if (st.subscribed) void st.subscribe();
  }

  function toggleSubscribe() {
    if (st.subscribed) st.unsubscribe();
    else void st.subscribe();
  }

  async function toggleMonitor(on: boolean) {
    if (!on) {
      st.stopMonitor();
      return;
    }
    const production = conn?.env === "production";
    const ok = await confirm({
      title: t("console.pubsub.monitorTitle"),
      message: t("console.pubsub.monitorWarning") + (production ? `\n\n${t("console.danger.production")}` : ""),
      danger: true,
      confirmLabel: t("console.pubsub.monitorStart"),
      requireText: production ? conn?.name || conn?.host : undefined,
    });
    if (ok) void st.startMonitor();
  }

  async function publish(e?: SubmitEvent) {
    e?.preventDefault();
    const channel = st.publishChannel.trim();
    if (!channel || publishing) return;
    publishing = true;
    try {
      const reply = await api.console.exec(ws.connectionId, 0, `PUBLISH ${quoteArg(channel)} ${quoteArg(st.publishMessage)}`, "");
      if (reply.value.t === "err") toast("error", t("console.pubsub.publishFailed"), { message: reply.value.v });
      else toast("success", t("console.pubsub.published", { count: reply.value.t === "int" ? reply.value.v : 0 }), { timeout: 2000 });
    } catch (err) {
      if (err instanceof ApiError && err.kind === "readOnly") toast("warning", t("common.readOnlyBlocked"));
      else toastError(err);
    } finally {
      publishing = false;
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

  function onlistkey(e: KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    if (!filtered.length) return;
    let index = filtered.findIndex((x) => x.id === st.selectedId);
    if (e.key === "Home") index = 0;
    else if (e.key === "End") index = filtered.length - 1;
    else index = index < 0 ? (e.key === "ArrowDown" ? 0 : filtered.length - 1) : Math.max(0, Math.min(filtered.length - 1, index + (e.key === "ArrowDown" ? 1 : -1)));
    st.selectedId = filtered[index].id;
    list?.scrollToIndex(index);
  }

  function clock(ms: number): string {
    const d = new Date(ms);
    const p = (n: number, w = 2) => String(n).padStart(w, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
  }

  function jumpToEnd() {
    st.setPaused(false);
    st.autoScroll = true;
  }
</script>

{#snippet row(index: number)}
  {@const entry = filtered[index]}
  {#if entry}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="row" class:selected={entry.id === st.selectedId} role="option" tabindex="-1" aria-selected={entry.id === st.selectedId} onclick={() => (st.selectedId = entry.id)}>
      <span class="c-time mono tabular">{clock(entry.at)}</span>
      {#if entry.source === "monitor"}
        <span class="c-chan mono truncate muted">{entry.channel}{entry.db !== null ? ` · db${entry.db}` : ""}</span>
        <span class="c-pat"><span class="badge mon">MON</span></span>
      {:else}
        <span class="c-chan mono truncate">{entry.channel}</span>
        <span class="c-pat mono truncate">{#if entry.pattern}<span class="badge">{entry.pattern}</span>{/if}</span>
      {/if}
      <span class="c-body mono truncate">{entry.preview}</span>
    </div>
  {/if}
{/snippet}

<div class="pubsub">
  <div class="bar top">
    <ChipInput targets={st.targets} onadd={addTargets} onremove={removeTarget} ontoggle={toggleKind} onsubmit={() => !st.subscribed && void st.subscribe()} />
    <button class="btn sm" class:primary={!st.subscribed} disabled={!st.targets.length && !st.subscribed} onclick={toggleSubscribe}>
      {#if st.subscribed}<Square size={13} /> {t("console.pubsub.unsubscribe")}{:else}<Radio size={14} /> {t("console.pubsub.subscribe")}{/if}
    </button>
    <span class="sep"></span>
    <button class="btn sm monitor" class:active={st.monitoring} aria-pressed={st.monitoring} use:tooltip={t("console.pubsub.monitorHint")} onclick={() => void toggleMonitor(!st.monitoring)}>
      <Activity size={13} /> MONITOR
    </button>
    {#if !st.monitoring}
      <NodeSelect connectionId={ws.connectionId} bind:value={st.monitorNode} />
    {/if}
  </div>

  {#if st.monitoring}
    <div class="warnline"><TriangleAlert size={13} /> {t("console.pubsub.monitorActive")}</div>
  {/if}

  <div class="bar sub">
    <label class="search">
      <Search size={13} />
      <input class="mono" bind:value={st.filter} placeholder={t("console.pubsub.filter")} spellcheck="false" autocomplete="off" />
    </label>
    <span class="count muted tabular">
      {#if st.filter.trim()}{t("console.pubsub.countFiltered", { shown: filtered.length, total: st.entries.length })}{:else}{t("console.pubsub.count", { count: st.entries.length })}{/if}
      {#if st.entries.length >= MAX_ENTRIES}<span use:tooltip={t("console.pubsub.capped", { max: MAX_ENTRIES })}> · {t("console.pubsub.cappedShort")}</span>{/if}
    </span>
    {#if live}<span class="livedot" use:tooltip={t("console.pubsub.listening")}></span>{/if}
    <span class="grow"></span>
    {#if st.paused && st.pausedNew}<span class="newcount tabular">{t("console.pubsub.newWhilePaused", { count: st.pausedNew })}</span>{/if}
    <button class="btn ghost sm" class:on={st.paused} aria-pressed={st.paused} aria-label={st.paused ? t("console.pubsub.resume") : t("console.pubsub.pause")} onclick={() => st.setPaused(!st.paused)}>
      {#if st.paused}<Play size={13} /><span class="lbl">{t("console.pubsub.resume")}</span>{:else}<Pause size={13} /><span class="lbl">{t("console.pubsub.pause")}</span>{/if}
    </button>
    <button class="btn ghost sm" class:on={st.autoScroll} aria-pressed={st.autoScroll} aria-label={t("console.pubsub.autoScroll")} use:tooltip={t("console.pubsub.autoScrollHint")} onclick={() => (st.autoScroll ? (st.autoScroll = false) : jumpToEnd())}>
      <ArrowDownToLine size={13} /><span class="lbl">{t("console.pubsub.autoScroll")}</span>
    </button>
    <button class="btn ghost icon sm" aria-label={t("common.clear")} use:tooltip={t("common.clear")} disabled={!st.entries.length} onclick={() => st.clear()}><Eraser size={14} /></button>
  </div>

  <div class="main">
    <div class="split">
      <div class="listcol">
        <div class="thead">
          <span class="c-time">{t("console.pubsub.colTime")}</span>
          <span class="c-chan">{t("console.pubsub.colChannel")}</span>
          <span class="c-pat">{t("console.pubsub.colPattern")}</span>
          <span class="c-body">{t("console.pubsub.colPayload")}</span>
        </div>
        <div class="list">
          <VirtualList bind:this={list} count={filtered.length} rowHeight={ROW} {row} tabindex={0} role="listbox" label={t("console.pubsub.messages")} onkeydown={onlistkey}>
            {#snippet empty()}
              <EmptyState
                compact
                icon={Radio}
                title={st.entries.length ? t("common.noResults") : live ? t("console.pubsub.waiting") : t("console.pubsub.emptyTitle")}
                description={st.entries.length || live ? undefined : t("console.pubsub.emptyText")}
              />
            {/snippet}
          </VirtualList>
        </div>
        <form class="publish" onsubmit={publish}>
          <input class="input sm mono chan" bind:value={st.publishChannel} placeholder={t("console.pubsub.channel")} spellcheck="false" autocomplete="off" aria-label={t("console.pubsub.channel")} />
          <input class="input sm mono msg" bind:value={st.publishMessage} placeholder={t("console.pubsub.message")} spellcheck="false" autocomplete="off" aria-label={t("console.pubsub.message")} />
          <button class="btn sm" type="submit" disabled={!st.publishChannel.trim() || publishing}><Send size={13} /> {t("console.pubsub.publish")}</button>
        </form>
      </div>
      <Resizer bind:width={viewerWidth} min={260} max={760} initial={380} side="right" />
      <div class="viewercol" style:width="{viewerWidth}px">
        <PayloadView entry={selected} oncopy={copy} />
      </div>
    </div>
  </div>
</div>

<style>
  .pubsub {
    container: pubsub / inline-size;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--bg);
    font-variant-ligatures: none;
  }

  .bar {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
    padding: 6px 8px 6px 10px;
  }

  .bar.top {
    align-items: flex-start;
    border-bottom: 1px solid var(--border-subtle);
  }

  .bar.top > :global(.btn),
  .bar.top > :global(select) {
    margin-top: 2px;
  }

  .bar.sub {
    padding-top: 5px;
    padding-bottom: 5px;
    border-bottom: 1px solid var(--border-subtle);
    font-size: var(--fs-sm);
  }

  .sep {
    width: 1px;
    height: 20px;
    margin: 4px 4px 0;
    background: var(--border);
  }

  .monitor {
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  .monitor.active {
    background: var(--warning-soft);
    border-color: var(--warning);
    color: var(--warning);
  }

  .warnline {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
    padding: 4px 12px;
    background: var(--warning-soft);
    color: var(--warning);
    font-size: var(--fs-sm);
  }

  .search {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 0 1 240px;
    min-width: 110px;
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
    font-size: var(--fs-xs);
  }

  .count {
    font-size: var(--fs-xs);
    white-space: nowrap;
  }

  @container pubsub (max-width: 560px) {
    .lbl,
    .count {
      display: none;
    }
  }

  .livedot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--success);
    box-shadow: 0 0 0 3px var(--success-soft);
    animation: pulse 1.6s var(--ease) infinite;
  }

  @keyframes pulse {
    50% {
      opacity: 0.45;
    }
  }

  .newcount {
    padding: 0 7px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent-text);
    font-size: var(--fs-xs);
    line-height: 18px;
  }

  .btn.on {
    background: var(--bg-selected);
    color: var(--accent-text);
  }

  .main {
    flex: 1;
    min-height: 0;
    container: pubsub-main / inline-size;
  }

  .split {
    display: flex;
    height: 100%;
  }

  .listcol {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
    container: pubsub-list / inline-size;
  }

  .viewercol {
    flex: none;
    min-width: 0;
    max-width: 60%;
  }

  /* Dar sekmede içerik görünümü listenin altına iner */
  @container pubsub-main (max-width: 860px) {
    .split {
      flex-direction: column;
    }

    .split > :global(.resizer) {
      display: none;
    }

    .viewercol {
      width: auto !important;
      max-width: none;
      height: 42%;
      flex: none;
      border-top: 1px solid var(--border);
    }
  }

  @container pubsub-list (max-width: 520px) {
    .thead,
    .row {
      grid-template-columns: 88px minmax(60px, 32%) minmax(0, 1fr);
      gap: 8px;
    }

    .c-pat {
      display: none;
    }
  }

  .thead,
  .row {
    display: grid;
    grid-template-columns: 96px minmax(90px, 200px) minmax(0, 120px) minmax(0, 1fr);
    align-items: center;
    gap: 10px;
    padding: 0 12px;
  }

  .thead {
    height: 26px;
    flex: none;
    border-bottom: 1px solid var(--border-subtle);
    color: var(--text-3);
    font-size: var(--fs-xs);
    font-weight: 600;
  }

  .list {
    flex: 1;
    min-height: 0;
  }

  .row {
    height: 26px;
    font-size: var(--fs-xs);
    cursor: default;
    border-bottom: 1px solid var(--border-subtle);
  }

  .row:hover {
    background: var(--bg-hover);
  }

  .row.selected {
    background: var(--bg-selected);
  }

  .c-time {
    color: var(--text-3);
  }

  .c-chan {
    color: var(--accent-text);
  }

  .c-chan.muted {
    color: var(--text-2);
  }

  .c-pat {
    min-width: 0;
    overflow: hidden;
  }

  .c-body {
    color: var(--text);
  }

  .badge {
    display: inline-block;
    max-width: 100%;
    padding: 0 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: middle;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent-text);
    font-size: var(--fs-2xs);
    line-height: 16px;
  }

  .badge.mon {
    background: var(--warning-soft);
    color: var(--warning);
    font-family: var(--font-ui);
    font-weight: 700;
  }

  .publish {
    display: flex;
    gap: 6px;
    flex: none;
    padding: 7px 8px 8px 10px;
    border-top: 1px solid var(--border-subtle);
    background: var(--bg-sunken);
  }

  .publish .chan {
    width: min(200px, 32%);
    min-width: 90px;
    flex: none;
  }

  .publish .msg {
    flex: 1;
  }
</style>
