<script lang="ts">
  // Birden çok satır seçiliyken detay panelinin yerine: sayı + toplu işlemler.
  import Copy from "@lucide/svelte/icons/copy";
  import ListChecks from "@lucide/svelte/icons/list-checks";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import { t } from "$lib/i18n/index.svelte";

  let { count, readOnly, ondelete, oncopy }: { count: number; readOnly: boolean; ondelete: () => void; oncopy: () => void } = $props();
</script>

<div class="summary">
  <ListChecks size={22} strokeWidth={1.6} />
  <div class="title">{t("common.selected", { count })}</div>
  <div class="row">
    <button class="btn sm" onclick={oncopy}><Copy size={13} /> {t("editors.table.copyJson")}</button>
    {#if !readOnly}
      <button class="btn danger sm" onclick={ondelete}><Trash2 size={13} /> {t("editors.table.deleteSelected", { count })}</button>
    {/if}
  </div>
  <p class="hint">{t("editors.table.multiHint")}</p>
</div>

<style>
  .summary {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 100%;
    color: var(--text-3);
  }

  .title {
    color: var(--text);
    font-weight: 600;
  }
</style>
