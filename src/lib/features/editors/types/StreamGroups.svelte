<script lang="ts">
  // Tüketici grupları (XINFO GROUPS): ad, tüketici, bekleyen, son teslim edilen kimlik.
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Users from "@lucide/svelte/icons/users";
  import X from "@lucide/svelte/icons/x";
  import { api } from "$lib/api";
  import type { RBytes, StreamGroup } from "$lib/api/types";
  import { fmtNumber, t } from "$lib/i18n/index.svelte";
  import EmptyState from "$lib/ui/EmptyState.svelte";
  import Spinner from "$lib/ui/Spinner.svelte";
  import { tooltip } from "$lib/ui/tooltip.svelte";
  import { describeError } from "../messages";

  let { connectionId, db, keyName, onclose }: { connectionId: string; db: number; keyName: RBytes; onclose: () => void } = $props();

  let groups = $state.raw<StreamGroup[] | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(false);

  async function load() {
    loading = true;
    error = null;
    try {
      groups = await api.stream.groups(connectionId, db, keyName);
    } catch (err) {
      error = describeError(err);
    } finally {
      loading = false;
    }
  }

  void load();
</script>

<aside class="groups">
  <div class="head">
    <Users size={14} />
    <span class="grow">{t("editors.stream.groups")}</span>
    <button class="btn ghost icon sm" onclick={load} disabled={loading} use:tooltip={t("common.refresh")} aria-label={t("common.refresh")}>
      {#if loading}<Spinner size={12} />{:else}<RefreshCw size={13} />{/if}
    </button>
    <button class="btn ghost icon sm" onclick={onclose} aria-label={t("common.close")}><X size={14} /></button>
  </div>
  <div class="list">
    {#if error}
      <p class="error-text selectable pad">{error}</p>
    {:else if groups && groups.length === 0}
      <EmptyState compact icon={Users} title={t("editors.stream.noGroups")} description={t("editors.stream.noGroupsHint")} />
    {:else if groups}
      {#each groups as group (group.name)}
        <div class="group">
          <div class="name mono selectable">{group.name}</div>
          <dl>
            <dt>{t("editors.stream.consumers")}</dt>
            <dd class="tabular">{fmtNumber(group.consumers)}</dd>
            <dt>{t("editors.stream.pending")}</dt>
            <dd class="tabular" class:warn={group.pending > 0}>{fmtNumber(group.pending)}</dd>
            <dt>{t("editors.stream.lastDelivered")}</dt>
            <dd class="mono selectable">{group.lastDeliveredId}</dd>
          </dl>
        </div>
      {/each}
    {/if}
  </div>
</aside>

<style>
  .groups {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
    background: var(--bg-sunken);
  }

  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 38px;
    padding: 0 6px 0 10px;
    border-bottom: 1px solid var(--border-subtle);
    font-weight: 600;
    font-size: var(--fs-sm);
  }

  .list {
    flex: 1;
    overflow: auto;
    padding: 8px;
  }

  .pad {
    padding: 8px;
  }

  .group {
    padding: 8px 10px;
    margin-bottom: 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
  }

  .name {
    font-weight: 600;
    margin-bottom: 6px;
  }

  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 3px 10px;
    margin: 0;
    font-size: var(--fs-sm);
  }

  dt {
    color: var(--text-3);
  }

  dd {
    margin: 0;
    text-align: right;
  }

  .warn {
    color: var(--warning);
    font-weight: 600;
  }
</style>
