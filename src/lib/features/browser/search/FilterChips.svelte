<script lang="ts">
  // Varsayılandan farklı arama durumu için küçük çipler (mod, Aa, türler); × ile tek tıkla geri alınır.
  import X from "@lucide/svelte/icons/x";
  import type { KeyFilter } from "$lib/api/types";
  import { t } from "$lib/i18n/index.svelte";
  import { tooltip } from "$lib/ui/tooltip.svelte";

  interface Props {
    filter: KeyFilter;
    onmode: () => void;
    oncase: () => void;
    ontypes: () => void;
  }

  let { filter, onmode, oncase, ontypes }: Props = $props();

  const visible = $derived(filter.mode !== "contains" || filter.caseSensitive || filter.types.length > 0);
</script>

{#if visible}
  <div class="chips">
    {#if filter.mode !== "contains"}
      <span class="chip" use:tooltip={t(`browser.search.modeHints.${filter.mode}`)}>
        {t(`browser.search.modes.${filter.mode}`)}
        <button aria-label={t("browser.search.removeChip")} onclick={onmode}><X size={11} /></button>
      </span>
    {/if}
    {#if filter.caseSensitive}
      <span class="chip" use:tooltip={t("browser.search.caseOn")}>
        {t("browser.search.chipCase")}
        <button aria-label={t("browser.search.removeChip")} onclick={oncase}><X size={11} /></button>
      </span>
    {/if}
    {#if filter.types.length}
      <span class="chip">
        <span class="truncate">{t("browser.search.chipTypes", { types: filter.types.map((x) => (x === "ReJSON-RL" ? "json" : x)).join(", ") })}</span>
        <button aria-label={t("browser.search.removeChip")} onclick={ontypes}><X size={11} /></button>
      </span>
    {/if}
  </div>
{/if}

<style>
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    max-width: 100%;
    height: 20px;
    padding: 0 2px 0 7px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent-text);
    font-size: var(--fs-xs);
    font-weight: 500;
  }

  button {
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    border: 0;
    border-radius: 50%;
    background: none;
    color: inherit;
    cursor: pointer;
  }

  button:hover {
    background: color-mix(in srgb, var(--accent) 22%, transparent);
  }
</style>
