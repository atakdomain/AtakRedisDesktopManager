<script lang="ts">
  import type { Workspace } from "$lib/state/workspace.svelte";
  import SlowlogView from "./SlowlogView.svelte";

  let { ws }: { ws: Workspace } = $props();
</script>

<!-- Sekme başka bağlantıda yeniden kullanılırsa liste sıfırdan yüklenir -->
{#key ws.connectionId}
  <SlowlogView {ws} />
{/key}
