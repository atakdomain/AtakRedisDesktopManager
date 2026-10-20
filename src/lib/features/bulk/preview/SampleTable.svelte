<script lang="ts">
  // Önizleme örnekleri (en fazla 500): yeniden adlandırma/kopyada eski → yeni (değişen kısım vurgulu) + not.
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import { label } from "$lib/api/bytes";
  import type { BulkNote, BulkSampleItem } from "$lib/api/types";
  import { t } from "$lib/i18n/index.svelte";
  import { tooltip } from "$lib/ui/tooltip.svelte";
  import VirtualList from "$lib/ui/VirtualList.svelte";
  import { nameDiff } from "../model/preview";

  interface Props {
    items: readonly BulkSampleItem[];
    /** Yeni ad sütunu (yeniden adlandırma) */
    mapping: boolean;
    height?: number;
  }

  let { items, mapping, height }: Props = $props();

  function noteKey(note: BulkNote): "ok" | Exclude<BulkNote, ""> {
    return note === "" ? "ok" : note;
  }
</script>

<div class="table" class:fill={!height} style:height={height ? `${height}px` : undefined}>
  <div class="head" class:mapping>
    {#if mapping}
      <span>{t("bulk.preview.oldName")}</span>
      <span></span>
      <span>{t("bulk.preview.newName")}</span>
    {:else}
      <span>{t("bulk.preview.key")}</span>
    {/if}
  </div>
  <div class="body">
    <VirtualList count={items.length} rowHeight={24} overscan={8}>
      {#snippet row(index)}
        {@const item = items[index]}
        {@const before = label(item.key)}
        {@const after = item.newKey === null ? null : label(item.newKey)}
        {@const skipped = item.note !== ""}
        <div class="row" class:mapping class:skipped>
          {#if mapping}
            {#if after !== null}
              {@const diff = nameDiff(before, after)}
              <span class="cell mono">{diff.prefix}<del>{diff.removed}</del>{diff.suffix}</span>
              <span class="arrow"><ArrowRight size={12} /></span>
              <span class="cell mono">{diff.prefix}<ins>{diff.added}</ins>{diff.suffix}</span>
            {:else}
              <span class="cell mono">{before}</span>
              <span class="arrow"><ArrowRight size={12} /></span>
              <span class="cell muted">—</span>
            {/if}
          {:else}
            <span class="cell mono">{before}</span>
          {/if}
          {#if item.note}
            <span class="note {noteKey(item.note)}" use:tooltip={t(`bulk.preview.noteHints.${noteKey(item.note)}`)}>{t(`bulk.preview.notes.${noteKey(item.note)}`)}</span>
          {/if}
        </div>
      {/snippet}
    </VirtualList>
  </div>
</div>

<style>
  .table {
    display: flex;
    flex-direction: column;
    min-height: 160px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
    overflow: hidden;
  }

  /* Yükseklik verilmediyse (sekme) kalan alanı doldurur */
  .table.fill {
    flex: 1;
  }

  .head,
  .row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
  }

  .head.mapping,
  .row.mapping {
    grid-template-columns: minmax(0, 1fr) 14px minmax(0, 1fr) auto;
  }

  .head {
    height: 26px;
    flex: none;
    border-bottom: 1px solid var(--border-subtle);
    background: var(--bg-sunken);
    color: var(--text-3);
    font-size: var(--fs-xs);
    font-weight: 600;
  }

  .body {
    flex: 1;
    min-height: 0;
  }

  .row {
    height: 24px;
    font-size: var(--fs-sm);
  }

  .row:hover {
    background: var(--bg-hover);
  }

  .row.skipped .cell {
    color: var(--text-3);
  }

  .cell {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  del {
    text-decoration: line-through;
    text-decoration-color: color-mix(in srgb, var(--danger) 70%, transparent);
    background: var(--danger-soft);
    color: var(--danger);
    border-radius: 2px;
  }

  ins {
    text-decoration: none;
    background: var(--success-soft);
    color: var(--success);
    border-radius: 2px;
  }

  .arrow {
    display: grid;
    color: var(--text-3);
  }

  .note {
    padding: 0 6px;
    border-radius: 999px;
    font-size: var(--fs-2xs);
    font-weight: 600;
    line-height: 16px;
    white-space: nowrap;
    background: var(--bg-active);
    color: var(--text-2);
  }

  .note.ok {
    background: var(--success-soft);
    color: var(--success);
  }

  .note.exists,
  .note.duplicate {
    background: var(--warning-soft);
    color: var(--warning);
  }

  .note.binary {
    background: var(--danger-soft);
    color: var(--danger);
  }
</style>
