<script lang="ts">
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import CircleX from "@lucide/svelte/icons/circle-x";
  import Ban from "@lucide/svelte/icons/ban";
  import Layers from "@lucide/svelte/icons/layers";
  import { fmtNumber, t } from "$lib/i18n/index.svelte";
  import { cancelJob, clearFinishedJobs, jobs, type Job } from "$lib/state/jobs.svelte";
  import { connections } from "$lib/state/connections.svelte";
  import EmptyState from "$lib/ui/EmptyState.svelte";
  import Popover from "$lib/ui/Popover.svelte";
  import Progress from "$lib/ui/Progress.svelte";
  import Spinner from "$lib/ui/Spinner.svelte";
  import { fmtDuration } from "$lib/util/format";

  let { anchor, onclose }: { anchor: HTMLElement; onclose: () => void } = $props();

  const visible = $derived(jobs.filter((j) => !j.spec?.dryRun));

  function ratio(job: Job): number | null {
    const total = job.progress.total;
    return total ? job.progress.processed / total : null;
  }
</script>

<Popover {anchor} {onclose} align="end" width={380}>
  <div class="head">
    <span class="title">{t("shell.status.jobs")}</span>
    {#if visible.some((j) => j.status !== "running")}
      <button class="btn ghost sm" onclick={clearFinishedJobs}>{t("shell.status.clearFinished")}</button>
    {/if}
  </div>
  {#if visible.length === 0}
    <EmptyState icon={Layers} title={t("shell.status.noJobs")} compact />
  {:else}
    <ul>
      {#each visible as job (job.id)}
        <li>
          <div class="row">
            <span class="state">
              {#if job.status === "running"}<Spinner size={13} />
              {:else if job.status === "done" && (job.summary?.failed ?? 0) === 0}<span class="ok"><CircleCheck size={15} /></span>
              {:else if job.status === "cancelled"}<span class="muted"><Ban size={15} /></span>
              {:else}<span class="bad"><CircleX size={15} /></span>
              {/if}
            </span>
            <div class="grow">
              <div class="name truncate">{job.title}</div>
              <div class="meta truncate">
                {connections.byId(job.connectionId)?.name ?? ""} · db{job.db}
                {#if job.summary} · {fmtDuration(job.summary.elapsedMs)}{/if}
              </div>
            </div>
            {#if job.status === "running"}
              <button class="btn sm" onclick={() => cancelJob(job.id)}>{t("shell.status.cancel")}</button>
            {/if}
          </div>
          {#if job.status === "running"}
            <Progress value={ratio(job)} />
            <div class="meta tabular">
              {fmtNumber(job.progress.processed)}{#if job.progress.total} / {fmtNumber(job.progress.total)}{/if}
              {#if job.progress.failed} · {fmtNumber(job.progress.failed)} ✕{/if}
            </div>
          {:else if job.summary}
            <div class="meta tabular">
              {job.status === "cancelled"
                ? t("shell.status.jobCancelled", { succeeded: job.summary.succeeded })
                : t("shell.status.jobDone", { succeeded: job.summary.succeeded, failed: job.summary.failed, skipped: job.summary.skipped })}
            </div>
          {:else if job.error}
            <div class="meta bad selectable">{job.error}</div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</Popover>

<style>
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px 6px;
  }

  .title {
    font-weight: 600;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 4px 8px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  li {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border-radius: var(--radius);
    background: var(--bg-sunken);
  }

  .state {
    display: grid;
    place-items: center;
    width: 18px;
    color: var(--accent);
  }

  .name {
    font-weight: 500;
  }

  .meta {
    font-size: var(--fs-xs);
    color: var(--text-3);
  }

  .ok {
    color: var(--success);
    display: grid;
  }

  .bad {
    color: var(--danger);
    display: grid;
  }
</style>
