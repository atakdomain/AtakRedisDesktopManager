<script lang="ts">
  // Önizleme: kesin eşleşme sayısı, not sayıları, örnek tablo. Anahtar listesinde sayı zaten bilinir; ilk adlar gösterilir.
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import type { BulkNote } from "$lib/api/types";
  import { fmtNumber, t } from "$lib/i18n/index.svelte";
  import Spinner from "$lib/ui/Spinner.svelte";
  import { tooltip } from "$lib/ui/tooltip.svelte";
  import type { BulkFlow } from "../flow.svelte";
  import { noteCounts } from "../model/preview";
  import SampleTable from "./SampleTable.svelte";

  let { flow, height }: { flow: BulkFlow; height?: number } = $props();

  const preview = $derived(flow.preview);
  const fresh = $derived(flow.previewFresh);
  const mapping = $derived(flow.draft.action === "rename");
  const counts = $derived(noteCounts(preview.samples));
  const NOTES: Exclude<BulkNote, "">[] = ["exists", "duplicate", "unchanged", "hasTtl", "binary"];
  /** Önizlemeden önce gösterilecek engel (eşleşme yokluğu sayıyla birlikte ayrıca gösterilir) */
  const issue = $derived(flow.issue && flow.issue.code !== "noMatches" ? flow.blocker : null);
  const keys = $derived(flow.source?.kind === "keys" ? flow.source.keys : null);
</script>

<section class="panel">
  <div class="summary">
    {#if issue && (flow.incomplete || flow.issue?.code === "regexInvalid")}
      <span class="muted">{issue}</span>
    {:else if issue}
      <span class="error"><CircleAlert size={13} /> {issue}</span>
    {:else if !flow.needsPreview && keys}
      <span class="count">{t("bulk.source.keys", { count: keys.length })}</span>
    {:else if preview.running}
      <Spinner size={13} />
      <span>{t("bulk.preview.counting")}</span>
      {#if preview.progress}
        <span class="muted tabular">{t("bulk.preview.scanned", { count: preview.progress.scanned })} · {fmtNumber(preview.progress.matched)}</span>
      {/if}
    {:else if preview.error}
      <span class="error"><CircleAlert size={13} /> {t("bulk.preview.failed")}: {preview.error}</span>
    {:else if fresh && flow.count !== null}
      <span class="count" class:zero={flow.count === 0}>{t("bulk.preview.matched", { count: flow.count })}</span>
      {#if preview.skipped > 0}<span class="skip tabular">· {t("bulk.preview.skipped", { count: preview.skipped })}</span>{/if}
    {:else}
      <span class="muted">{t("bulk.preview.stale")}</span>
    {/if}
    <span class="grow"></span>
    {#if flow.needsPreview && flow.built.ok && !preview.running}
      <button class="btn ghost icon sm" aria-label={t("bulk.preview.refresh")} use:tooltip={t("bulk.preview.refresh")} onclick={() => flow.refreshPreview()}>
        <RefreshCw size={13} />
      </button>
    {/if}
  </div>

  {#if flow.needsPreview && preview.samples.length > 0 && (fresh || preview.running)}
    {#if mapping || counts.exists + counts.duplicate + counts.unchanged + counts.hasTtl + counts.binary > 0}
      <div class="notes tabular">
        {#if mapping}<span class="note ok">{t("bulk.preview.notes.ok")} {fmtNumber(counts[""])}</span>{/if}
        {#each NOTES as note (note)}
          {#if counts[note] > 0}
            <span class="note {note}" use:tooltip={t(`bulk.preview.noteHints.${note}`)}>{t(`bulk.preview.notes.${note}`)} {fmtNumber(counts[note])}</span>
          {/if}
        {/each}
        {#if (flow.count ?? 0) > preview.samples.length}<span class="muted">· {t("bulk.preview.sample", { count: preview.samples.length })}</span>{/if}
      </div>
    {/if}
    <SampleTable items={preview.samples} {mapping} {height} />
  {:else if !flow.needsPreview && keys && keys.length > 0}
    <ul class="keys selectable">
      {#each flow.samples as name, i (i)}<li class="mono truncate">{name}</li>{/each}
      {#if keys.length > flow.samples.length}<li class="muted">… +{fmtNumber(keys.length - flow.samples.length)}</li>{/if}
    </ul>
  {/if}
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
  }

  .summary {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 26px;
    font-size: var(--fs-sm);
  }

  .count {
    font-weight: 600;
    font-size: var(--fs-md);
  }

  .count.zero {
    color: var(--text-3);
  }

  .skip {
    color: var(--warning);
    font-weight: 500;
  }

  .error {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--danger);
  }

  .notes {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 5px;
    font-size: var(--fs-xs);
  }

  .note {
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--bg-active);
    color: var(--text-2);
    font-weight: 600;
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

  .keys {
    margin: 0;
    padding: 6px 10px;
    list-style: none;
    max-height: 220px;
    overflow: auto;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius);
    background: var(--bg-sunken);
  }

  .keys li {
    line-height: 1.7;
  }
</style>
