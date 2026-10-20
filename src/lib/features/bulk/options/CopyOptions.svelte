<script lang="ts">
  import Info from "@lucide/svelte/icons/info";
  import { t } from "$lib/i18n/index.svelte";
  import { connections } from "$lib/state/connections.svelte";
  import type { BulkFlow } from "../flow.svelte";

  let { flow }: { flow: BulkFlow } = $props();

  const ws = $derived(flow.ws);
  const draft = $derived(flow.draft);
  const self = $derived(connections.byId(ws.connectionId));
  const others = $derived(connections.list.filter((c) => c.id !== ws.connectionId));
  const targetId = $derived(draft.targetConnectionId || ws.connectionId);
  const target = $derived(connections.byId(targetId));
  const targetSession = $derived(connections.sessions[targetId]);
  const targetCluster = $derived(target?.mode === "cluster" || targetSession?.mode === "cluster");
  const sourceCluster = $derived(connections.sessions[ws.connectionId]?.mode === "cluster");
  const dbCount = $derived(targetCluster ? 1 : (targetSession?.dbCount ?? (targetId === ws.connectionId ? ws.dbs.length : 0)) || 16);
  const dbOptions = $derived(Array.from({ length: dbCount }, (_, i) => i));

  function chooseTarget(id: string): void {
    flow.draft.targetConnectionId = id;
    const same = !id || id === ws.connectionId;
    flow.draft.targetDb = same && ws.db === 0 && !sourceCluster ? 1 : 0;
  }
</script>

<div class="options">
  <div class="grid">
    <div class="field">
      <label for="bulk-target">{t("bulk.options.targetConnection")}</label>
      <select id="bulk-target" class="select" value={draft.targetConnectionId} onchange={(e) => chooseTarget(e.currentTarget.value)}>
        <option value="">{t("bulk.options.thisConnection", { name: self?.name ?? "" })}</option>
        {#each others as conn (conn.id)}
          <option value={conn.id}>{conn.name || `${conn.host}:${conn.port}`}{conn.readOnly ? ` · ${t("common.readOnly")}` : ""}</option>
        {/each}
      </select>
    </div>
    <div class="field db">
      <label for="bulk-target-db">{t("bulk.options.targetDb")}</label>
      <select id="bulk-target-db" class="select tabular" bind:value={flow.draft.targetDb} disabled={targetCluster}>
        {#each dbOptions as db (db)}
          <option value={db} disabled={targetId === ws.connectionId && db === ws.db}>db{db}</option>
        {/each}
      </select>
    </div>
  </div>

  {#if targetCluster || (sourceCluster && targetId === ws.connectionId)}
    <p class="note"><Info size={13} /> {sourceCluster && targetId === ws.connectionId ? t("bulk.options.sourceClusterNote") : t("bulk.options.clusterNote")}</p>
  {/if}

  <label class="check">
    <input type="checkbox" bind:checked={flow.draft.replaceExisting} />
    <span>{t("bulk.options.replaceExisting")}</span>
  </label>
  <label class="check" class:disabled={ws.readOnly}>
    <input type="checkbox" bind:checked={flow.draft.moveKeys} disabled={ws.readOnly} />
    <span>{t("bulk.options.moveKeys")}</span>
  </label>
</div>

<style>
  .options {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 96px;
    gap: 8px;
  }

  .note {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    color: var(--text-2);
    font-size: var(--fs-xs);
    line-height: 1.5;
  }

  .note :global(svg) {
    flex: none;
    margin-top: 2px;
  }

  .disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
