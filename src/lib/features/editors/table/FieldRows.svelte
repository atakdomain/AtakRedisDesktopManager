<script lang="ts" module>
  export interface FieldRow {
    field: string;
    value: string;
  }
</script>

<script lang="ts">
  // Dinamik alan/değer satırları (stream girdisi). Son satırda Enter yeni satır açar.
  import Plus from "@lucide/svelte/icons/plus";
  import X from "@lucide/svelte/icons/x";
  import { tick } from "svelte";
  import { t } from "$lib/i18n/index.svelte";

  let { rows = $bindable(), idPrefix = "rows" }: { rows: FieldRow[]; idPrefix?: string } = $props();

  let list = $state<HTMLDivElement>();

  async function add() {
    rows.push({ field: "", value: "" });
    await tick();
    list?.querySelector<HTMLInputElement>(`[data-row="${rows.length - 1}"]`)?.focus();
  }

  function remove(index: number) {
    if (rows.length === 1) rows[0] = { field: "", value: "" };
    else rows.splice(index, 1);
  }
</script>

<div class="rows" bind:this={list}>
  <div class="head">
    <span>{t("editors.stream.field")}</span>
    <span>{t("editors.hash.value")}</span>
  </div>
  {#each rows as row, i (i)}
    <div class="row-item">
      <input
        id="{idPrefix}-f{i}"
        class="input sm mono"
        data-row={i}
        bind:value={row.field}
        placeholder={t("editors.stream.fieldPlaceholder")}
        spellcheck="false"
        autocomplete="off"
        aria-label={t("editors.stream.field")}
      />
      <input
        class="input sm mono"
        bind:value={row.value}
        placeholder={t("editors.stream.valuePlaceholder")}
        spellcheck="false"
        autocomplete="off"
        aria-label={t("editors.hash.value")}
        onkeydown={(e) => {
          if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && i === rows.length - 1 && row.field) {
            e.preventDefault();
            void add();
          }
        }}
      />
      <button type="button" class="btn ghost icon sm" aria-label={t("editors.stream.removeRow")} onclick={() => remove(i)}><X size={13} /></button>
    </div>
  {/each}
  <button type="button" class="btn ghost sm add" onclick={add}><Plus size={13} /> {t("editors.stream.addRow")}</button>
</div>

<style>
  .rows {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .head,
  .row-item {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 3fr) 24px;
    gap: 6px;
    align-items: center;
  }

  .head {
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-3);
  }

  .add {
    align-self: flex-start;
  }
</style>
