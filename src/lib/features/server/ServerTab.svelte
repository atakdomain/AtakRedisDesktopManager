<script lang="ts">
  import type { Workspace } from "$lib/state/workspace.svelte";
  import ServerDashboard from "./ServerDashboard.svelte";

  let { ws }: { ws: Workspace } = $props();
</script>

<!-- Sekme başka bağlantıda yeniden kullanılırsa pano sıfırdan kurulur -->
{#key ws.connectionId}
  <ServerDashboard {ws} />
{/key}
