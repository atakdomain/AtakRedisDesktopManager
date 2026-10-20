<script lang="ts">
  import { formatShortcut } from "$lib/state/commands.svelte";

  let { shortcut, subtle = false }: { shortcut: string; subtle?: boolean } = $props();
</script>

<span class="keys" class:subtle>
  {#each formatShortcut(shortcut) as part, i (i)}
    <span class="kbd">{part}</span>
  {/each}
</span>

<style>
  .keys {
    display: inline-flex;
    gap: 2px;
    flex: none;
  }

  .subtle .kbd {
    border: 0;
    background: none;
    padding: 0 1px;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
</style>
