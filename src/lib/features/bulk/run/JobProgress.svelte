<script lang="ts">
  // Canlı iş ilerlemesi: çubuk, işlenen/toplam, hız, kalan süre, hatalar; süzgeç kaynağında taranan/eşleşen.
  import { fmtNumber, t } from "$lib/i18n/index.svelte";
  import { cancelJob, type Job } from "$lib/state/jobs.svelte";
  import Progress from "$lib/ui/Progress.svelte";
  import Spinner from "$lib/ui/Spinner.svelte";
  import { fmtDuration } from "$lib/util/format";
  import { progressStats } from "../model/preview";

  let { job, note }: { job: Job; note?: string } = $props();

  let now = $state(Date.now());
  /** İşlemenin başladığı an (süzgeç kaynağında önce tarama sürer; hız ondan sonrası için hesaplanır) */
  let start = $state<{ at: number; processed: number } | null>(null);

  $effect(() => {
    if (job.status !== "running") return;
    const timer = setInterval(() => {
      now = Date.now();
      if (!start && job.progress.processed > 0) start = { at: now, processed: job.progress.processed };
    }, 250);
    return () => clearInterval(timer);
  });

  const elapsed = $derived(Math.max(0, now - job.startedAt));
  // Yeniden adlandırma önce tüm eşleşenleri toplar: işlem başlayınca eşleşen sayısı kesin toplamdır
  const total = $derived(job.progress.total ?? (job.spec?.action.kind === "rename" && job.progress.processed > 0 ? job.progress.matched : null));
  const stats = $derived.by(() => {
    const base = start ?? { at: job.startedAt, processed: 0 };
    const pace = progressStats({ processed: job.progress.processed - base.processed, total: total === null ? null : total - base.processed }, now - base.at);
    return { ...pace, ratio: total ? Math.min(1, job.progress.processed / total) : total === 0 ? 1 : null };
  });
  const filterSource = $derived(job.progress.total === null);
</script>

<div class="progress-view">
  <div class="title">
    {#if job.status === "running"}<Spinner size={14} />{/if}
    <span class="truncate">{note ?? job.title}</span>
  </div>
  <Progress value={stats.ratio} tone={job.progress.failed > 0 ? "danger" : "accent"} />
  <div class="numbers tabular">
    <span class="main">
      {#if total !== null}
        {t("bulk.run.of", { processed: job.progress.processed, total })}
      {:else}
        {t("bulk.run.processed", { count: job.progress.processed })}
      {/if}
    </span>
    {#if stats.rate > 0}<span>· {t("bulk.run.rate", { rate: fmtNumber(Math.round(stats.rate)) })}</span>{/if}
    {#if stats.etaMs !== null && job.status === "running"}<span>· {t("bulk.run.eta", { time: fmtDuration(stats.etaMs) })}</span>{/if}
    <span>· {fmtDuration(elapsed)}</span>
    {#if job.progress.failed > 0}<span class="bad">· {t("bulk.run.failures", { count: job.progress.failed })}</span>{/if}
  </div>
  {#if filterSource}
    <div class="numbers tabular muted">
      {t("bulk.run.scanned", { count: job.progress.scanned })} · {t("bulk.run.matched", { count: job.progress.matched })}
    </div>
  {/if}
  {#if job.status === "running"}
    <div class="actions">
      <button class="btn sm" onclick={() => cancelJob(job.id)}>{t("bulk.run.cancel")}</button>
    </div>
  {/if}
</div>

<style>
  .progress-view {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-sunken);
  }

  .title {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--accent);
    font-weight: 600;
  }

  .title span {
    color: var(--text);
  }

  .numbers {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    font-size: var(--fs-sm);
    color: var(--text-2);
  }

  .main {
    color: var(--text);
    font-weight: 600;
  }

  .bad {
    color: var(--danger);
    font-weight: 600;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
  }
</style>
