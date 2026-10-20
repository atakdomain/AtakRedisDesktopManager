<script lang="ts">
  // Bağlantının özellik simgeleri: cluster/sentinel, SSH, TLS, salt okunur
  import Network from "@lucide/svelte/icons/network";
  import PencilOff from "@lucide/svelte/icons/pencil-off";
  import Radar from "@lucide/svelte/icons/radar";
  import Route from "@lucide/svelte/icons/route";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import type { ConnectionConfig } from "$lib/api/types";
  import { t } from "$lib/i18n/index.svelte";
  import { tooltip } from "$lib/ui/tooltip.svelte";

  let { config, size = 12 }: { config: ConnectionConfig; size?: number } = $props();
</script>

{#if config.mode === "cluster"}
  <span class="icon" use:tooltip={t("connections.badges.cluster")}><Network {size} /></span>
{:else if config.mode === "sentinel"}
  <span class="icon" use:tooltip={t("connections.badges.sentinel")}><Radar {size} /></span>
{/if}
{#if config.ssh.enabled}
  <span class="icon" use:tooltip={`${t("connections.badges.ssh")} · ${config.ssh.host}`}><Route {size} /></span>
{/if}
{#if config.tls.enabled}
  <span class="icon" use:tooltip={t("connections.badges.tls")}><ShieldCheck {size} /></span>
{/if}
{#if config.readOnly}
  <span class="icon" use:tooltip={t("connections.badges.readOnly")}><PencilOff {size} /></span>
{/if}

<style>
  .icon {
    display: inline-grid;
    place-items: center;
    flex: none;
    color: var(--text-3);
  }
</style>
