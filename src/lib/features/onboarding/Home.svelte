<script lang="ts">
  import Download from "@lucide/svelte/icons/download";
  import Plus from "@lucide/svelte/icons/plus";
  import { onMount } from "svelte";
  import appIcon from "../../../../src-tauri/icons/icon.svg?url";
  import { connectionMenu, connectTo } from "$lib/features/connections/actions.svelte";
  import ConnectionIcons from "$lib/features/connections/ConnectionIcons.svelte";
  import { accentColor, address, displayName, envColor, visualOrder } from "$lib/features/connections/connectionInfo";
  import { loadPrefs, prefs } from "$lib/features/connections/prefs.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { connections, emptyConnection } from "$lib/state/connections.svelte";
  import { openContextMenu } from "$lib/state/menu.svelte";
  import { ui } from "$lib/state/ui.svelte";
  import Kbd from "$lib/ui/Kbd.svelte";
  import { ardm, detectArdm, newCandidateCount } from "./ardm.svelte";

  const LIMIT = 6;

  onMount(() => {
    void loadPrefs();
    // Ucuz bir algılama: kaç yeni ARDM bağlantısı olduğunu düğmede göstermek için
    void detectArdm();
  });

  const recent = $derived(prefs.recent.map((id) => connections.byId(id)).filter((c) => c !== undefined));
  const showingRecent = $derived(recent.length > 0);
  const shown = $derived((showingRecent ? recent : visualOrder(connections.list)).slice(0, LIMIT));
  const more = $derived(connections.list.length - shown.length);
  const newCount = $derived(ardm.scan ? newCandidateCount() : 0);

  const tips = [
    { shortcut: "Mod+K", label: () => t("onboarding.home.tipPalette") },
    { shortcut: "Mod+Shift+N", label: () => t("onboarding.home.tipNew") },
    { shortcut: "Mod+1", label: () => t("onboarding.home.tipSwitch") },
    { shortcut: "Mod+P", label: () => t("onboarding.home.tipKey") },
    { shortcut: "Mod+,", label: () => t("onboarding.home.tipSettings") },
  ];
</script>

<div class="home">
  <div class="inner">
    <header class="hero">
      <img src={appIcon} alt="" width="56" height="56" />
      <div>
        <h1>{t("common.appName")}</h1>
        <p>{t("onboarding.home.tagline")}</p>
      </div>
    </header>

    <div class="actions">
      <button class="action" onclick={() => (ui.connectionEditor = emptyConnection())}>
        <span class="action-icon primary"><Plus size={18} /></span>
        <span class="action-text">
          <span class="action-title">{t("onboarding.newConnection")}</span>
          <span class="action-sub">{t("onboarding.home.newText")}</span>
        </span>
        <Kbd shortcut="Mod+Shift+N" subtle />
      </button>
      <button class="action" class:highlight={newCount > 0} onclick={() => (ui.importOpen = true)}>
        <span class="action-icon"><Download size={18} /></span>
        <span class="action-text">
          <span class="action-title">{t("onboarding.home.importTitle")}</span>
          <span class="action-sub">{newCount > 0 ? t("onboarding.home.importReady", { count: newCount }) : t("onboarding.home.importText")}</span>
        </span>
        {#if newCount > 0}<span class="count tabular">{newCount}</span>{/if}
      </button>
    </div>

    {#if shown.length > 0}
      <section>
        <h2>{showingRecent ? t("onboarding.home.recent") : t("onboarding.home.all")}</h2>
        <div class="cards">
          {#each shown as c (c.id)}
            {@const status = connections.status[c.id] ?? "idle"}
            <button
              class="card"
              style:--tone={accentColor(c) ?? "var(--border-strong)"}
              onclick={() => connectTo(c.id)}
              oncontextmenu={(e) => openContextMenu(e, connectionMenu(c, { x: e.clientX, y: e.clientY }))}
            >
              <span class="card-top">
                <span class="name truncate">{displayName(c)}</span>
                {#if status !== "idle"}<span class="dot {status}"></span>{/if}
              </span>
              <span class="card-sub">
                <span class="addr truncate">{address(c)}</span>
                <ConnectionIcons config={c} size={12} />
              </span>
              {#if c.env !== "none" || c.group}
                <span class="card-tags">
                  {#if c.env !== "none"}<span class="tag env" style:--env={envColor(c.env)}>{t(`common.env.${c.env}`)}</span>{/if}
                  {#if c.group}<span class="tag truncate">{c.group}</span>{/if}
                </span>
              {/if}
            </button>
          {/each}
        </div>
        {#if more > 0}<p class="more">{t("onboarding.home.more", { count: more })}</p>{/if}
      </section>
    {/if}

    <section>
      <h2>{t("onboarding.home.tips")}</h2>
      <ul class="tips">
        {#each tips as tip (tip.shortcut)}
          <li>
            <span class="truncate">{tip.label()}</span>
            <span class="keys">
              <Kbd shortcut={tip.shortcut} />
              {#if tip.shortcut === "Mod+1"}<span class="muted">…</span><Kbd shortcut="Mod+9" />{/if}
            </span>
          </li>
        {/each}
      </ul>
    </section>
  </div>
</div>

<style>
  .home {
    height: 100%;
    overflow-y: auto;
    background: var(--bg-sunken);
  }

  .inner {
    display: flex;
    flex-direction: column;
    gap: 28px;
    width: min(720px, 100%);
    margin: 0 auto;
    padding: max(48px, 9vh) 32px 40px;
  }

  .hero {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .hero img {
    flex: none;
    filter: drop-shadow(0 6px 14px rgba(0, 0, 0, 0.2));
  }

  h1 {
    font-size: var(--fs-xl);
    font-weight: 650;
    letter-spacing: -0.01em;
  }

  .hero p {
    margin-top: 2px;
    color: var(--text-3);
  }

  .actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .action {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    padding: 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-elevated);
    box-shadow: var(--shadow-sm);
    text-align: left;
    cursor: pointer;
    transition:
      border-color var(--dur) var(--ease),
      box-shadow var(--dur) var(--ease);
  }

  .action:hover {
    border-color: var(--border-strong);
    box-shadow: var(--shadow);
  }

  .action.highlight {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  }

  .action-icon {
    display: grid;
    place-items: center;
    flex: none;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: var(--bg-active);
    color: var(--text-2);
  }

  .action-icon.primary {
    background: var(--accent);
    color: #fff;
  }

  .action-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .action-title {
    font-weight: 600;
  }

  .action-sub {
    color: var(--text-3);
    font-size: var(--fs-sm);
    line-height: 1.4;
  }

  .count {
    display: grid;
    place-items: center;
    flex: none;
    min-width: 22px;
    height: 22px;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--accent);
    color: #fff;
    font-size: var(--fs-xs);
    font-weight: 600;
  }

  section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  h2 {
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-3);
  }

  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 10px;
  }

  .card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    padding: 10px 12px 10px 15px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-elevated);
    text-align: left;
    cursor: pointer;
    overflow: hidden;
    transition:
      border-color var(--dur) var(--ease),
      box-shadow var(--dur) var(--ease);
  }

  .card::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background: var(--tone);
  }

  .card:hover {
    border-color: var(--border-strong);
    box-shadow: var(--shadow);
  }

  .card-top,
  .card-sub {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .name {
    flex: 1;
    min-width: 0;
    font-weight: 600;
  }

  .card-sub {
    color: var(--text-3);
    font-size: var(--fs-sm);
  }

  .addr {
    flex: 1;
    min-width: 0;
    font-variant-numeric: tabular-nums;
  }

  .card-tags {
    display: flex;
    gap: 4px;
    min-width: 0;
    margin-top: 4px;
  }

  .tag {
    height: 18px;
    padding: 0 6px;
    border-radius: 4px;
    background: var(--bg-active);
    color: var(--text-2);
    font-size: var(--fs-2xs);
    font-weight: 600;
    line-height: 18px;
  }

  .tag.env {
    flex: none;
    background: color-mix(in srgb, var(--env) 15%, transparent);
    color: var(--env);
  }

  .dot {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }

  .dot.connected {
    background: var(--success);
  }

  .dot.connecting {
    background: var(--warning);
  }

  .dot.error {
    background: var(--danger);
  }

  .more {
    color: var(--text-3);
    font-size: var(--fs-sm);
  }

  .tips {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0 24px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .tips li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    height: 32px;
    border-bottom: 1px solid var(--border-subtle);
    color: var(--text-2);
  }

  .keys {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex: none;
  }
</style>
