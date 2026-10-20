<script lang="ts">
  import type { Workspace } from "$lib/state/workspace.svelte";
  let { ws }: { ws: Workspace } = $props();
</script>

<div class="placeholder">KeyBrowser {ws.connectionId}</div>

<style>
  .placeholder {
    display: grid;
    place-items: center;
    height: 100%;
    color: var(--text-3);
    font-size: var(--fs-sm);
  }
</style>
