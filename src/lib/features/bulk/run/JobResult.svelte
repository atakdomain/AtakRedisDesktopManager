<script lang="ts">
  // İş sonucu: durum, sayılar, süre, çıktı dosyası ve kopyalanabilir hata listesi.
  import Ban from "@lucide/svelte/icons/ban";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import CircleX from "@lucide/svelte/icons/circle-x";
  import Copy from "@lucide/svelte/icons/copy";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import { label } from "$lib/api/bytes";
  import { t } from "$lib/i18n/index.svelte";
  import type { Job } from "$lib/state/jobs.svelte";
  import { toast, toastError } from "$lib/state/toasts.svelte";
  import { tooltip } from "$lib/ui/tooltip.svelte";
  import { copyText } from "$lib/util/clipboard";
  import { fmtDuration } from "$lib/util/format";

  let { job, error = null }: { job: Job; error?: string | null } = $props();

  const summary = $derived(job.summary);
  const cancelled = $derived(job.status === "cancelled" || !!summary?.cancelled);
  const kind = $derived(job.status === "failed" || error ? "failed" : cancelled ? "cancelled" : (summary?.failed ?? 0) > 0 ? "partial" : "done");

  async function copy(text: string): Promise<void> {
    try {
      await copyText(text);
      toast("success", t("common.copied"), { timeout: 1500 });
    } catch (err) {
      toastError(err);
    }
  }
</script>

<div class="result {kind}">
  <div class="head">
    <span class="icon">
      {#if kind === "done"}<CircleCheck size={18} />
      {:else if kind === "partial"}<TriangleAlert size={18} />
      {:else if kind === "cancelled"}<Ban size={18} />
      {:else}<CircleX size={18} />{/if}
    </span>
    <div class="grow">
      <div class="status">
        {kind === "done" ? t("bulk.result.done") : kind === "partial" ? t("bulk.result.doneWithErrors") : kind === "cancelled" ? t("bulk.result.cancelled") : t("bulk.result.failed")}
      </div>
      <div class="title truncate">{job.title}</div>
    </div>
  </div>

  {#if error}<p class="message">{error}</p>{/if}
  {#if job.error}<p class="message selectable">{job.error}</p>{/if}

  {#if summary}
    <div class="stats tabular">
      <span class="stat ok">{t("bulk.result.succeeded", { count: summary.succeeded })}</span>
      <span class="stat" class:bad={summary.failed > 0}>{t("bulk.result.failedCount", { count: summary.failed })}</span>
      <span class="stat">{t("bulk.result.skipped", { count: summary.skipped })}</span>
      <span class="stat muted">{fmtDuration(summary.elapsedMs)}</span>
    </div>
    {#if summary.outputPath}
      <div class="output">
        <span class="label">{t("bulk.result.output")}</span>
        <code class="selectable truncate grow">{summary.outputPath}</code>
        <button class="btn ghost icon sm" aria-label={t("common.copy")} use:tooltip={t("common.copy")} onclick={() => copy(summary.outputPath)}><Copy size={13} /></button>
      </div>
    {/if}
  {/if}

  {#if job.errors.length}
    <div class="errors">
      <div class="errors-head">
        <span class="label">{t("bulk.result.errors")}</span>
        <button class="btn ghost sm" onclick={() => copy(job.errors.map((e) => `${label(e.key)}\t${e.message}`).join("\n"))}>
          <Copy size={12} />
          {t("bulk.result.copyErrors")}
        </button>
      </div>
      <ul class="selectable">
        {#each job.errors as item, i (i)}
          <li><code class="key truncate">{label(item.key)}</code><span class="msg">{item.message}</span></li>
        {/each}
      </ul>
      {#if job.errors.length >= 200}<p class="hint">{t("bulk.result.errorsCapped")}</p>{/if}
    </div>
  {/if}
</div>

<style>
  .result {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-sunken);
  }

  .head {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .icon {
    display: grid;
    flex: none;
  }

  .done .icon {
    color: var(--success);
  }

  .partial .icon {
    color: var(--warning);
  }

  .cancelled .icon {
    color: var(--text-3);
  }

  .failed .icon {
    color: var(--danger);
  }

  .status {
    font-weight: 600;
  }

  .title {
    color: var(--text-3);
    font-size: var(--fs-sm);
  }

  .message {
    color: var(--danger);
    font-size: var(--fs-sm);
  }

  .stats {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .stat {
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--bg-active);
    font-size: var(--fs-xs);
    font-weight: 600;
  }

  .stat.ok {
    background: var(--success-soft);
    color: var(--success);
  }

  .stat.bad {
    background: var(--danger-soft);
    color: var(--danger);
  }

  .output {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .label {
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-2);
  }

  .errors {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .errors-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  ul {
    max-height: 200px;
    overflow: auto;
    margin: 0;
    padding: 4px 0;
    list-style: none;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius);
    background: var(--bg);
  }

  li {
    display: flex;
    gap: 10px;
    padding: 3px 10px;
    font-size: var(--fs-sm);
    line-height: 1.5;
  }

  .key {
    flex: 0 1 45%;
    min-width: 0;
  }

  .msg {
    flex: 1;
    min-width: 0;
    color: var(--danger);
  }
</style>
