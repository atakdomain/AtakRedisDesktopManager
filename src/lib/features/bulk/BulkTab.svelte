<script lang="ts">
  import type { Tab, Workspace } from "$lib/state/workspace.svelte";
  let { ws, tab }: { ws: Workspace; tab: Tab } = $props();
</script>

<div class="placeholder">BulkTab {ws.connectionId} {tab.id}</div>

<style>
  .placeholder {
    display: grid;
    place-items: center;
    height: 100%;
    color: var(--text-3);
    font-size: var(--fs-sm);
  }
</style>
