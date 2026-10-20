<script lang="ts">
  import Layers from "@lucide/svelte/icons/layers";
  import Lock from "@lucide/svelte/icons/lock";
  import Moon from "@lucide/svelte/icons/moon";
  import Settings from "@lucide/svelte/icons/settings";
  import Sun from "@lucide/svelte/icons/sun";
  import { t } from "$lib/i18n/index.svelte";
  import { connections } from "$lib/state/connections.svelte";
  import { jobs } from "$lib/state/jobs.svelte";
  import { resolvedTheme, settings } from "$lib/state/settings.svelte";
  import { ui } from "$lib/state/ui.svelte";
  import { workspaceFor } from "$lib/state/workspace.svelte";
  import Spinner from "$lib/ui/Spinner.svelte";
  import { tooltip } from "$lib/ui/tooltip.svelte";
  import JobsPopover from "./JobsPopover.svelte";

  let jobsButton = $state<HTMLButtonElement>();

  const conn = $derived(connections.active);
  const status = $derived(conn ? (connections.status[conn.id] ?? "idle") : "idle");
  const session = $derived(connections.activeSession);
  const ws = $derived(conn && status === "connected" ? workspaceFor(conn.id) : null);
  const dbInfo = $derived(ws ? ws.dbs.find((d) => d.index === ws.db) : undefined);
  const running = $derived(jobs.filter((j) => j.status === "running" && !j.spec?.dryRun));
  const anyJobs = $derived(jobs.some((j) => !j.spec?.dryRun));
  const dark = $derived(resolvedTheme() === "dark");
</script>

<footer class="status">
  {#if conn}
    <span class="item conn">
      <span class="dot {status}"></span>
      <span class="truncate name">{conn.name || `${conn.host}:${conn.port}`}</span>
    </span>
    {#if conn.env === "production"}<span class="pill prod">{t("shell.status.production")}</span>{/if}
    {#if conn.readOnly}<span class="pill"><Lock size={11} /> {t("shell.status.readOnly")}</span>{/if}
    {#if session}
      <span class="item muted">Redis {session.serverVersion}</span>
      <span class="item muted">{session.mode}</span>
    {/if}
    {#if ws && dbInfo}
      <span class="item muted tabular">db{ws.db} · {t("shell.status.dbKeys", { count: dbInfo.keys })}</span>
    {/if}
  {/if}

  <span class="grow"></span>

  {#if anyJobs}
    <button class="item button" bind:this={jobsButton} onclick={() => (ui.jobsOpen = !ui.jobsOpen)}>
      {#if running.length}
        <Spinner size={11} />
        <span>{t("shell.status.jobsRunning", { count: running.length })}</span>
      {:else}
        <Layers size={13} />
        <span>{t("shell.status.jobs")}</span>
      {/if}
    </button>
  {/if}
  <button
    class="item button"
    aria-label={t("shell.commands.toggleTheme")}
    use:tooltip={t("shell.commands.toggleTheme")}
    onclick={() => (settings.theme = dark ? "light" : "dark")}
  >
    {#if dark}<Sun size={13} />{:else}<Moon size={13} />{/if}
  </button>
  <button class="item button" aria-label={t("common.settings")} use:tooltip={{ text: t("common.settings"), shortcut: "Mod+," }} onclick={() => (ui.settingsOpen = true)}>
    <Settings size={13} />
  </button>
</footer>

{#if ui.jobsOpen && jobsButton}
  <JobsPopover anchor={jobsButton} onclose={() => (ui.jobsOpen = false)} />
{/if}

<style>
  .status {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 26px;
    flex: none;
    padding: 0 6px;
    border-top: 1px solid var(--border);
    background: var(--bg-rail);
    font-size: var(--fs-xs);
    color: var(--text-2);
  }

  .item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 20px;
    padding: 0 6px;
    border-radius: var(--radius-sm);
    min-width: 0;
  }

  .conn {
    max-width: 260px;
    font-weight: 500;
    color: var(--text);
  }

  .button {
    border: 0;
    background: none;
    color: inherit;
    font-size: inherit;
    cursor: pointer;
  }

  .button:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .dot {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--text-3);
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

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 16px;
    padding: 0 6px;
    margin: 0 2px;
    border-radius: 999px;
    background: var(--bg-active);
    font-size: var(--fs-2xs);
    font-weight: 600;
  }

  .pill.prod {
    background: var(--danger);
    color: #fff;
    letter-spacing: 0.04em;
  }
</style>
