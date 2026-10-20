<script lang="ts">
  // Listenin sonunda: kaç öğe yüklendi + daha fazla / tümünü yükle.
  import { t } from "$lib/i18n/index.svelte";
  import Spinner from "$lib/ui/Spinner.svelte";

  interface Props {
    loaded: number;
    total: number;
    done: boolean;
    loading: boolean;
    onmore: () => void;
    onall?: () => void;
    onstop?: () => void;
  }

  let { loaded, total, done, loading, onmore, onall, onstop }: Props = $props();
</script>

{#if !done || loading}
  <div class="footer">
    {#if loading}
      <Spinner size={12} />
      <span>{t("common.loading")}</span>
      {#if onstop}<button class="btn ghost sm" onclick={onstop}>{t("editors.table.stop")}</button>{/if}
    {:else}
      <span class="muted tabular">{t("editors.table.loadedOf", { loaded, total })}</span>
      <button class="btn sm" onclick={onmore}>{t("common.loadMore")}</button>
      {#if onall}<button class="btn ghost sm" onclick={onall}>{t("common.loadAll")}</button>{/if}
    {/if}
  </div>
{/if}

<style>
  .footer {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 40px;
    color: var(--text-2);
    font-size: var(--fs-sm);
  }
</style>
