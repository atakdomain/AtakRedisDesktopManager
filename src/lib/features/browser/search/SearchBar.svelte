<script lang="ts">
  // Gezginin arama satırı: FilterInput çalışma alanının süzgecini gösterir; değişince yeniden tarar.
  import type { SearchMode } from "$lib/api/types";
  import type { BrowserController } from "../controller.svelte";
  import FilterChips from "./FilterChips.svelte";
  import FilterInput from "./FilterInput.svelte";

  let { ctl, onnavigate }: { ctl: BrowserController; onnavigate: (where: "down" | "escape") => void } = $props();

  let input = $state<FilterInput>();

  export function focus(): void {
    input?.focus();
  }

  export function toggleCase(): void {
    input?.toggleCase();
  }

  export function toggleRegex(): void {
    input?.toggleRegex();
  }

  export function setMode(mode: SearchMode): void {
    input?.setMode(mode);
  }
</script>

<div class="search">
  <FilterInput bind:this={input} filter={ctl.ws.filter} sticky onchange={(next, search) => ctl.setFilter(next, search)} {onnavigate} />
  <FilterChips filter={ctl.ws.filter} onmode={() => input?.setMode("contains")} oncase={() => input?.toggleCase()} ontypes={() => input?.setTypes([])} />
</div>

<style>
  .search {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 8px 4px;
  }
</style>
