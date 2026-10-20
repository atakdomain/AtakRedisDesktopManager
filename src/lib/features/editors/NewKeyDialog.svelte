<script lang="ts">
  import type { Workspace } from "$lib/state/workspace.svelte";

  /** `prefix`: klasörden açıldıysa ad öneki (ör. "user:") */
  let { ws, prefix = "", onclose }: { ws: Workspace; prefix?: string; onclose: () => void } = $props();
</script>

<div hidden>{ws.connectionId}{prefix}<button onclick={onclose}>x</button></div>
