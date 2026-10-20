<script lang="ts">
  import type { Workspace } from "$lib/state/workspace.svelte";
  import BrowserView from "./BrowserView.svelte";

  let { ws }: { ws: Workspace } = $props();
</script>

<!-- Bağlantı değişince görünüm baştan kurulur; gezgin durumu bağlantı başına önbellekte kalır -->
{#key ws}
  <BrowserView {ws} />
{/key}
