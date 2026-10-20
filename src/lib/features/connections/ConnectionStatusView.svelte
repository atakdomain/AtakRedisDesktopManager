<script lang="ts">
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import Copy from "@lucide/svelte/icons/copy";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Plug from "@lucide/svelte/icons/plug";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Route from "@lucide/svelte/icons/route";
  import { t } from "$lib/i18n/index.svelte";
  import { connections } from "$lib/state/connections.svelte";
  import { toast } from "$lib/state/toasts.svelte";
  import Spinner from "$lib/ui/Spinner.svelte";
  import { tooltip } from "$lib/ui/tooltip.svelte";
  import { copyText } from "$lib/util/clipboard";
  import { connectTo, editConnection } from "./actions.svelte";
  import ConnectionIcons from "./ConnectionIcons.svelte";
  import { accentColor, address, displayName } from "./connectionInfo";
  import { describeConnectionError, sshTarget } from "./errors";

  let { connectionId }: { connectionId: string } = $props();

  const config = $derived(connections.byId(connectionId));
  const status = $derived(connections.status[connectionId] ?? "idle");
  const error = $derived(connections.errors[connectionId]);
  const described = $derived(error ? describeConnectionError(error, config) : null);

  async function copyError() {
    if (!error) return;
    await copyText(error.message);
    toast("success", t("common.copied"));
  }
</script>

{#if config}
  <div class="view">
    <div class="card" style:--tone={accentColor(config) ?? "var(--border-strong)"}>
      {#if status === "error" && described && error}
        <div class="badge danger"><CircleAlert size={22} /></div>
        <h2>{described.title}</h2>
        <p class="lead">{described.text}</p>
        <div class="target">
          <span class="tone"></span>
          <span class="truncate">{displayName(config)}</span>
          <span class="muted mono">{address(config)}</span>
        </div>
        <div class="raw">
          <div class="raw-head">
            <span>{t("connections.view.serverSaid")} · {error.kind}</span>
            <button class="btn ghost icon sm" aria-label={t("connections.view.copyError")} use:tooltip={t("connections.view.copyError")} onclick={copyError}>
              <Copy size={13} />
            </button>
          </div>
          <pre class="mono selectable">{error.message}</pre>
        </div>
        <div class="actions">
          <button class="btn" onclick={() => editConnection(config)}><Pencil size={14} />{t("connections.view.edit")}</button>
          <button class="btn primary" onclick={() => connectTo(connectionId, true)}>
            <RefreshCw size={14} />{t("common.retry")}
          </button>
        </div>
      {:else if status === "idle"}
        <div class="badge"><Plug size={22} /></div>
        <h2 class="truncate">{displayName(config)}</h2>
        <p class="sub">
          <span class="mono">{address(config)}</span>
          <ConnectionIcons {config} size={13} />
        </p>
        <p class="lead">{t("connections.view.idleText")}</p>
        <div class="actions">
          <button class="btn" onclick={() => editConnection(config)}><Pencil size={14} />{t("connections.view.edit")}</button>
          <button class="btn primary" onclick={() => connectTo(connectionId)}><Plug size={14} />{t("connections.view.connect")}</button>
        </div>
      {:else}
        <div class="badge"><Spinner size={22} /></div>
        <h2 class="truncate">{t("connections.view.connectingTo", { name: displayName(config) })}</h2>
        <p class="sub">
          <span class="mono">{address(config)}</span>
          <ConnectionIcons {config} size={13} />
        </p>
        {#if config.ssh.enabled}
          <p class="hop"><Route size={13} />{t("connections.view.via", { target: sshTarget(config) })}</p>
        {/if}
      {/if}
    </div>
  </div>
{/if}

<style>
  .view {
    display: grid;
    place-items: center;
    height: 100%;
    padding: 32px 24px;
    overflow: auto;
    background: var(--bg-sunken);
  }

  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: min(520px, 100%);
    text-align: center;
  }

  .badge {
    display: grid;
    place-items: center;
    width: 52px;
    height: 52px;
    margin-bottom: 14px;
    border-radius: 14px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    color: var(--text-2);
    box-shadow: inset 0 -3px 0 color-mix(in srgb, var(--tone) 70%, transparent);
  }

  .badge.danger {
    background: var(--danger-soft);
    border-color: transparent;
    color: var(--danger);
    box-shadow: none;
  }

  h2 {
    max-width: 100%;
    font-size: var(--fs-lg);
    font-weight: 600;
  }

  .sub {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
    color: var(--text-3);
  }

  .lead {
    margin-top: 8px;
    max-width: 440px;
    color: var(--text-2);
    line-height: 1.55;
  }

  .hop {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 12px;
    padding: 3px 10px;
    border-radius: 999px;
    background: var(--bg-active);
    color: var(--text-2);
    font-size: var(--fs-sm);
  }

  .target {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: 100%;
    margin-top: 14px;
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg-elevated);
    font-size: var(--fs-sm);
    font-weight: 500;
  }

  .tone {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--tone);
  }

  .raw {
    width: 100%;
    margin-top: 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-elevated);
    text-align: left;
    overflow: hidden;
  }

  .raw-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 30px;
    padding: 0 4px 0 12px;
    border-bottom: 1px solid var(--border-subtle);
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    color: var(--text-3);
  }

  pre {
    margin: 0;
    padding: 10px 12px;
    max-height: 160px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--text);
  }

  .actions {
    display: flex;
    gap: 8px;
    margin-top: 20px;
  }
</style>
