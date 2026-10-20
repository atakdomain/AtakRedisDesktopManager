<script lang="ts">
  import Activity from "@lucide/svelte/icons/activity";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import Clock from "@lucide/svelte/icons/clock";
  import Cpu from "@lucide/svelte/icons/cpu";
  import Database from "@lucide/svelte/icons/database";
  import GitBranch from "@lucide/svelte/icons/git-branch";
  import HardDrive from "@lucide/svelte/icons/hard-drive";
  import MemoryStick from "@lucide/svelte/icons/memory-stick";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Target from "@lucide/svelte/icons/target";
  import Users from "@lucide/svelte/icons/users";
  import { untrack } from "svelte";
  import { api, ApiError } from "$lib/api";
  import { fmtNumber, t } from "$lib/i18n/index.svelte";
  import type { Workspace } from "$lib/state/workspace.svelte";
  import EmptyState from "$lib/ui/EmptyState.svelte";
  import Segmented from "$lib/ui/Segmented.svelte";
  import Spinner from "$lib/ui/Spinner.svelte";
  import Switch from "$lib/ui/Switch.svelte";
  import { tooltip } from "$lib/ui/tooltip.svelte";
  import { fmtBytes } from "$lib/util/format";
  import ClientsPanel from "./ClientsPanel.svelte";
  import ConfigPanel from "./ConfigPanel.svelte";
  import { keyspace, parseInfo, summarize, type Info } from "./info";
  import InfoPanel from "./InfoPanel.svelte";
  import NodeSelect from "./NodeSelect.svelte";
  import Sparkline from "./Sparkline.svelte";
  import { fmtAgo, fmtUptime } from "./util";

  let { ws }: { ws: Workspace } = $props();

  const POLL_MS = 2000;
  /** Grafikte tutulan örnek sayısı (3 dk) */
  const SAMPLES = 90;

  let node = $state("");
  let live = $state(true);
  let info = $state.raw<Info | null>(null);
  let error = $state<ApiError | null>(null);
  let refreshing = $state(false);
  let ops = $state.raw<number[]>([]);
  let updatedAt = $state(0);
  let section = $state<"info" | "config" | "clients">("info");
  let docVisible = $state(typeof document === "undefined" || document.visibilityState === "visible");
  let generation = 0;

  const visible = $derived(ws.activeTabId === "server" && docVisible);
  const s = $derived(info ? summarize(info) : null);
  const dbs = $derived(info ? keyspace(info) : []);
  const memLimit = $derived(s?.maxMemory ? s.maxMemory : (s?.systemMemory ?? 0));
  const memRatio = $derived(s?.usedMemory != null && memLimit ? Math.min(1, s.usedMemory / memLimit) : null);
  const replica = $derived(s?.role === "slave" || s?.role === "replica");

  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    const gen = generation;
    try {
      const text = await api.server.info(ws.connectionId, node);
      if (gen !== generation) return;
      const parsed = parseInfo(text);
      info = parsed;
      error = null;
      updatedAt = Date.now();
      const value = Number(parsed.map.get("instantaneous_ops_per_sec"));
      if (Number.isFinite(value)) ops = [...ops, value].slice(-SAMPLES);
    } catch (err) {
      if (gen !== generation) return;
      error = err instanceof ApiError ? err : new ApiError("internal", String(err));
      ws.handleError(err, false);
    } finally {
      refreshing = false;
    }
  }

  function changeNode() {
    generation++;
    refreshing = false;
    info = null;
    ops = [];
    error = null;
    void refresh();
  }

  // Görünürken ve canlıyken 2 sn'de bir; gizliyken durur, geri gelince hemen yeniler
  $effect(() => {
    if (!visible) return;
    untrack(() => void refresh());
    if (!live) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  });

  function pct(ratio: number): string {
    return t("server.pct", { n: Math.round(ratio * 1000) / 10 });
  }

  function num(value: number | null | undefined): string {
    return value === null || value === undefined ? "—" : fmtNumber(value);
  }

  function bytes(value: number | null | undefined): string {
    return value === null || value === undefined ? "—" : fmtBytes(value);
  }

  function tone(ratio: number | null): string {
    if (ratio === null) return "";
    return ratio >= 0.9 ? "danger" : ratio >= 0.75 ? "warn" : "";
  }
</script>

<svelte:document onvisibilitychange={() => (docVisible = document.visibilityState === "visible")} />

<div class="dash">
  <header class="head">
    <div class="ident">
      <div class="title-row">
        <h2>Redis {s?.version ?? ""}</h2>
        {#if s?.mode}<span class="pill">{s.mode}</span>{/if}
        {#if s?.role}<span class="pill accent">{replica ? "replica" : s.role}</span>{/if}
      </div>
      <div class="facts">
        {#if s?.uptimeSec != null}<span><Clock size={12} /> {t("server.uptime", { time: fmtUptime(s.uptimeSec) })}</span>{/if}
        {#if s?.os}<span class="truncate"><Cpu size={12} /> {s.os}</span>{/if}
      </div>
    </div>
    <div class="controls">
      <NodeSelect connectionId={ws.connectionId} bind:value={node} onchange={changeNode} />
      <span class="live" use:tooltip={t("server.liveHint")}><Switch bind:checked={live}>{t("server.live")}</Switch></span>
      {#if error && info}
        <span class="stale" use:tooltip={error.message}><CircleAlert size={13} /> {t("server.stale")}</span>
      {:else if updatedAt}
        <span class="updated tabular">{new Date(updatedAt).toLocaleTimeString()}</span>
      {/if}
      <button class="btn ghost icon sm" aria-label={t("common.refresh")} use:tooltip={t("common.refresh")} onclick={() => void refresh()}>
        {#if refreshing && !live}<Spinner size={13} />{:else}<RefreshCw size={14} />{/if}
      </button>
    </div>
  </header>

  {#if !info}
    {#if error}
      <EmptyState icon={CircleAlert} title={t("server.loadFailed")} description={error.message}>
        <button class="btn sm" onclick={() => void refresh()}>{t("common.retry")}</button>
      </EmptyState>
    {:else}
      <div class="loading"><Spinner size={18} /></div>
    {/if}
  {:else if s}
    <div class="cards">
      <section class="card">
        <div class="card-head"><MemoryStick size={14} /> {t("server.memory.title")}</div>
        <div class="big tabular">{bytes(s.usedMemory)}</div>
        {#if memRatio !== null}
          <div class="meter {tone(memRatio)}" use:tooltip={pct(memRatio)}><span style:width="{memRatio * 100}%"></span></div>
          <div class="caption tabular">{t(s.maxMemory ? "server.memory.ofMax" : "server.memory.ofSystem", { pct: pct(memRatio), max: fmtBytes(memLimit) })}</div>
        {/if}
        <dl class="rows">
          <div><dt>{t("server.memory.peak")}</dt><dd>{bytes(s.usedMemoryPeak)}</dd></div>
          <div><dt>{t("server.memory.max")}</dt><dd>{s.maxMemory ? fmtBytes(s.maxMemory) : t("server.memory.unlimited")}</dd></div>
          <div><dt>RSS</dt><dd>{bytes(s.usedMemoryRss)}</dd></div>
          <div>
            <dt>{t("server.memory.fragmentation")}</dt>
            <dd class:warn={s.fragmentation !== null && (s.fragmentation > 1.5 || s.fragmentation < 1)} use:tooltip={t("server.memory.fragmentationHint")}>{s.fragmentation ?? "—"}</dd>
          </div>
          <div><dt>{t("server.memory.policy")}</dt><dd class="mono">{s.evictionPolicy || "—"}</dd></div>
        </dl>
      </section>

      <section class="card">
        <div class="card-head"><Activity size={14} /> {t("server.ops.title")}</div>
        <div class="big tabular">{num(s.opsPerSec)}<span class="unit">{t("server.ops.unit")}</span></div>
        <div class="spark"><Sparkline values={ops} label={t("server.ops.title")} /></div>
        <dl class="rows">
          <div><dt>{t("server.ops.input")}</dt><dd>{s.inputKbps === null ? "—" : `${fmtNumber(s.inputKbps)} KB/s`}</dd></div>
          <div><dt>{t("server.ops.output")}</dt><dd>{s.outputKbps === null ? "—" : `${fmtNumber(s.outputKbps)} KB/s`}</dd></div>
          <div><dt>{t("server.ops.total")}</dt><dd>{num(s.totalCommands)}</dd></div>
        </dl>
      </section>

      <section class="card">
        <div class="card-head"><Users size={14} /> {t("server.clients.title")}</div>
        <div class="big tabular">{num(s.clients)}</div>
        <dl class="rows">
          <div><dt>{t("server.clients.blocked")}</dt><dd>{num(s.blockedClients)}</dd></div>
          {#if s.maxClients !== null}<div><dt>{t("server.clients.max")}</dt><dd>{num(s.maxClients)}</dd></div>{/if}
        </dl>
        <button class="link" onclick={() => (section = "clients")}>{t("server.clients.show")}</button>
      </section>

      <section class="card">
        <div class="card-head"><Target size={14} /> {t("server.hits.title")}</div>
        <div class="big tabular">{s.hitRatio === null ? "—" : pct(s.hitRatio)}</div>
        {#if s.hitRatio !== null}<div class="meter good"><span style:width="{s.hitRatio * 100}%"></span></div>{/if}
        <dl class="rows">
          <div><dt>{t("server.hits.hits")}</dt><dd>{num(s.hits)}</dd></div>
          <div><dt>{t("server.hits.misses")}</dt><dd>{num(s.misses)}</dd></div>
          <div><dt>{t("server.hits.expired")}</dt><dd>{num(s.expiredKeys)}</dd></div>
          <div><dt>{t("server.hits.evicted")}</dt><dd class:warn={!!s.evictedKeys}>{num(s.evictedKeys)}</dd></div>
        </dl>
      </section>

      <section class="card">
        <div class="card-head"><GitBranch size={14} /> {t("server.replication.title")}</div>
        <div class="big">{replica ? "replica" : s.role || "—"}</div>
        <dl class="rows">
          {#if replica}
            <div><dt>{t("server.replication.master")}</dt><dd class="mono">{s.masterHost || "—"}</dd></div>
            <div>
              <dt>{t("server.replication.link")}</dt>
              <dd class:good={s.masterLinkStatus === "up"} class:bad={s.masterLinkStatus === "down"}>{s.masterLinkStatus || "—"}</dd>
            </div>
          {:else}
            <div><dt>{t("server.replication.replicas")}</dt><dd>{num(s.connectedReplicas)}</dd></div>
          {/if}
          <div><dt>{t("server.replication.offset")}</dt><dd>{num(s.replOffset)}</dd></div>
        </dl>
      </section>

      <section class="card">
        <div class="card-head"><HardDrive size={14} /> {t("server.persistence.title")}</div>
        <div class="big small">{s.rdbLastSave ? fmtAgo(s.rdbLastSave, updatedAt) : "—"}</div>
        <div class="caption">{t("server.persistence.lastSave")}</div>
        <dl class="rows">
          <div><dt>{t("server.persistence.changes")}</dt><dd>{num(s.rdbChanges)}</dd></div>
          <div><dt>{t("server.persistence.status")}</dt><dd class:good={s.rdbLastStatus === "ok"} class:bad={!!s.rdbLastStatus && s.rdbLastStatus !== "ok"}>{s.rdbLastStatus || "—"}</dd></div>
          <div><dt>AOF</dt><dd>{s.aofEnabled === null ? "—" : s.aofEnabled ? t("common.enabled") : t("common.disabled")}</dd></div>
        </dl>
      </section>

      <section class="card wide">
        <div class="card-head"><Database size={14} /> {t("server.keyspace.title")}</div>
        {#if dbs.length}
          <table class="ks tabular">
            <thead>
              <tr><th>DB</th><th>{t("server.keyspace.keys")}</th><th>{t("server.keyspace.expires")}</th><th>{t("server.keyspace.avgTtl")}</th></tr>
            </thead>
            <tbody>
              {#each dbs as row (row.db)}
                <tr class:current={row.db === ws.db}>
                  <td class="mono">db{row.db}</td>
                  <td>{fmtNumber(row.keys)}</td>
                  <td>{fmtNumber(row.expires)}</td>
                  <td>{row.avgTtl > 0 ? fmtUptime(row.avgTtl / 1000) : "—"}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {:else}
          <p class="caption">{t("server.keyspace.empty")}</p>
        {/if}
      </section>
    </div>

    <div class="sections">
      <div class="section-bar">
        <Segmented
          size="sm"
          bind:value={section}
          options={[
            { value: "info", label: t("server.sections.info") },
            { value: "config", label: t("server.sections.config") },
            { value: "clients", label: t("server.sections.clients") },
          ]}
        />
      </div>
      {#if section === "info"}
        <InfoPanel {info} />
      {:else if section === "config"}
        <ConfigPanel {ws} {node} />
      {:else}
        <ClientsPanel {ws} {node} />
      {/if}
    </div>
  {/if}
</div>

<style>
  .dash {
    height: 100%;
    overflow-y: auto;
    background: var(--bg-sunken);
    font-variant-ligatures: none;
  }

  .head {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-subtle);
    background: var(--bg);
  }

  .ident {
    flex: 1;
    min-width: 0;
  }

  .title-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  h2 {
    font-size: var(--fs-lg);
    font-weight: 600;
  }

  .pill {
    padding: 0 8px;
    border-radius: 999px;
    background: var(--bg-active);
    color: var(--text-2);
    font-size: var(--fs-xs);
    font-weight: 500;
    line-height: 19px;
  }

  .pill.accent {
    background: var(--accent-soft);
    color: var(--accent-text);
  }

  .facts {
    display: flex;
    gap: 14px;
    margin-top: 3px;
    min-width: 0;
    color: var(--text-3);
    font-size: var(--fs-sm);
  }

  .facts span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: none;
    font-size: var(--fs-sm);
  }

  .live {
    display: inline-flex;
  }

  .live :global(.text) {
    font-size: var(--fs-sm);
    color: var(--text-2);
  }

  .updated {
    color: var(--text-3);
    font-size: var(--fs-xs);
  }

  .stale {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--warning);
    font-size: var(--fs-xs);
  }

  .loading {
    display: grid;
    place-items: center;
    height: 200px;
    color: var(--text-3);
  }

  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
    gap: 12px;
    padding: 14px 16px 4px;
  }

  .card {
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg);
  }

  .card.wide {
    grid-column: 1 / -1;
  }

  .card-head {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-3);
    font-size: var(--fs-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .big {
    margin-top: 6px;
    font-size: 22px;
    font-weight: 600;
    line-height: 1.2;
    letter-spacing: -0.01em;
  }

  .big.small {
    font-size: var(--fs-lg);
  }

  .unit {
    margin-left: 6px;
    color: var(--text-3);
    font-size: var(--fs-sm);
    font-weight: 500;
  }

  .caption {
    margin-top: 4px;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }

  .meter {
    height: 5px;
    margin-top: 8px;
    border-radius: 999px;
    background: var(--bg-active);
    overflow: hidden;
  }

  .meter span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--accent);
    transition: width 300ms var(--ease);
  }

  .meter.warn span {
    background: var(--warning);
  }

  .meter.danger span {
    background: var(--danger);
  }

  .meter.good span {
    background: var(--success);
  }

  .spark {
    margin-top: 6px;
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin: 10px 0 0;
    font-size: var(--fs-sm);
  }

  .rows div {
    display: flex;
    justify-content: space-between;
    gap: 10px;
  }

  .rows dt {
    color: var(--text-3);
  }

  .rows dd {
    margin: 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .warn {
    color: var(--warning);
  }

  .good {
    color: var(--success);
  }

  .bad {
    color: var(--danger);
  }

  .link {
    align-self: flex-start;
    margin-top: auto;
    padding: 8px 0 0;
    border: 0;
    background: none;
    color: var(--accent-text);
    font-size: var(--fs-sm);
    cursor: pointer;
  }

  .link:hover {
    text-decoration: underline;
  }

  .ks {
    width: 100%;
    max-width: 720px;
    margin-top: 8px;
    border-collapse: collapse;
    font-size: var(--fs-sm);
  }

  .ks th {
    padding: 3px 6px;
    color: var(--text-3);
    font-size: var(--fs-xs);
    font-weight: 600;
    text-align: right;
    border-bottom: 1px solid var(--border-subtle);
  }

  .ks td {
    padding: 3px 6px;
    text-align: right;
    border-bottom: 1px solid var(--border-subtle);
  }

  .ks th:first-child,
  .ks td:first-child {
    text-align: left;
  }

  .ks tr.current td {
    background: var(--bg-selected);
  }

  .sections {
    margin: 12px 16px 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg);
    overflow: hidden;
  }

  .section-bar {
    display: flex;
    align-items: center;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border-subtle);
  }
</style>
