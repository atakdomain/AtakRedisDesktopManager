<script lang="ts">
  // Cluster düğüm seçici; cluster dışı bağlantılarda hiç görünmez. "" = otomatik / varsayılan düğüm.
  import { t } from "$lib/i18n/index.svelte";
  import { connections } from "$lib/state/connections.svelte";
  import { tooltip } from "$lib/ui/tooltip.svelte";

  let { connectionId, value = $bindable(""), auto = false, onchange }: { connectionId: string; value: string; auto?: boolean; onchange?: (value: string) => void } = $props();

  const session = $derived(connections.sessions[connectionId]);
  const nodes = $derived(session?.mode === "cluster" ? session.nodes : []);
</script>

{#if nodes.length > 0}
  <select
    class="select sm node"
    bind:value
    aria-label={t("server.node.label")}
    use:tooltip={t("server.node.label")}
    onchange={() => onchange?.(value)}
  >
    <option value="">{auto ? t("server.node.auto") : t("server.node.default")}</option>
    {#each nodes as node (node.addr)}
      <option value={node.addr}>{node.addr} · {node.role}{node.slots ? ` · ${node.slots}` : ""}</option>
    {/each}
  </select>
{/if}

<style>
  .node {
    width: auto;
    max-width: 280px;
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
  }
</style>
