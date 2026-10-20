<script lang="ts">
  // Dosyadan içe aktarma (Atak dışa aktarma dosyası: DUMP .jsonl ya da JSON). İş durum çubuğunda da izlenir.
  import Upload from "@lucide/svelte/icons/upload";
  import { t } from "$lib/i18n/index.svelte";
  import { connections } from "$lib/state/connections.svelte";
  import { jobs, runImport, type Job } from "$lib/state/jobs.svelte";
  import type { Workspace } from "$lib/state/workspace.svelte";
  import Modal from "$lib/ui/Modal.svelte";
  import { notifyJob } from "./execute.svelte";
  import { pickOpenPath } from "./files";
  import JobProgress from "./run/JobProgress.svelte";
  import JobResult from "./run/JobResult.svelte";

  let { ws, onclose }: { ws: Workspace; onclose: () => void } = $props();

  let path = $state("");
  let replace = $state(false);
  let typed = $state("");
  let job = $state.raw<Job | null>(null);
  let closing = false;

  const conn = $derived(connections.byId(ws.connectionId));
  const confirmText = $derived(conn?.env === "production" && replace ? conn.name : null);
  const fileName = $derived(path.split(/[\\/]/).pop() ?? path);
  const canRun = $derived(!!path.trim() && !ws.readOnly && (!confirmText || typed.trim() === confirmText));

  async function browse(): Promise<void> {
    const picked = await pickOpenPath(t("bulk.import.title"));
    if (picked) path = picked;
  }

  async function run(): Promise<void> {
    if (!canRun) return;
    const done = runImport(ws.connectionId, ws.db, path.trim(), replace, t("bulk.jobs.import", { file: fileName }));
    job = jobs[0];
    const finished = await done;
    void ws.search();
    void ws.loadDbs();
    notifyJob(finished);
    if (!closing && finished.status === "done" && (finished.summary?.failed ?? 0) === 0) close();
  }

  function close(): void {
    closing = true;
    onclose();
  }
</script>

<Modal title={t("bulk.import.title")} subtitle={t("bulk.import.subtitle")} size="md" onclose={close}>
  {#snippet icon()}
    <span class="badge"><Upload size={16} /></span>
  {/snippet}

  {#if !job}
    <form
      id="bulk-import-form"
      class="body"
      onsubmit={(e) => {
        e.preventDefault();
        void run();
      }}
    >
      <div class="field">
        <label for="bulk-import-path">{t("bulk.import.file")}</label>
        <div class="row">
          <input id="bulk-import-path" class="input mono grow" spellcheck="false" placeholder={t("bulk.import.filePlaceholder")} bind:value={path} />
          <button class="btn" type="button" onclick={browse} data-autofocus>{t("bulk.options.browse")}</button>
        </div>
        <span class="hint">{t("bulk.import.fileHint")}</span>
      </div>
      <div class="target">
        <span class="label">{t("bulk.import.target")}</span>
        <span class="mono">{conn?.name ?? ""} · db{ws.db}</span>
      </div>
      <label class="check">
        <input type="checkbox" bind:checked={replace} />
        <span>{t("bulk.import.replace")}</span>
      </label>
      <p class="hint indent">{t("bulk.import.replaceHint")}</p>
      {#if confirmText}
        <div class="field confirm">
          <label for="bulk-import-confirm">{t("bulk.run.typeName", { name: confirmText })}</label>
          <input id="bulk-import-confirm" class="input mono" bind:value={typed} autocomplete="off" spellcheck="false" />
        </div>
      {/if}
      {#if ws.readOnly}<p class="error-text">{t("common.readOnlyBlocked")}</p>{/if}
    </form>
  {:else if job.status === "running"}
    <JobProgress {job} />
  {:else}
    <JobResult {job} />
  {/if}

  {#snippet footer()}
    {#if !job}
      <button class="btn" type="button" onclick={close}>{t("common.cancel")}</button>
      <button class="btn primary" type="submit" form="bulk-import-form" disabled={!canRun}>{t("bulk.import.run")}</button>
    {:else if job.status === "running"}
      <button class="btn" onclick={close}>{t("bulk.run.background")}</button>
    {:else}
      <button class="btn primary" onclick={close}>{t("common.close")}</button>
    {/if}
  {/snippet}
</Modal>

<style>
  .body {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .badge {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 9px;
    background: var(--accent-soft);
    color: var(--accent-text);
  }

  .target {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: var(--radius);
    background: var(--bg-sunken);
  }

  .label {
    font-size: var(--fs-sm);
    font-weight: 500;
    color: var(--text-2);
  }

  .indent {
    margin-top: -8px;
    padding-left: 23px;
  }

  .confirm {
    padding: 10px 12px;
    border: 1px solid color-mix(in srgb, var(--danger) 35%, transparent);
    border-radius: var(--radius);
    background: var(--danger-soft);
  }
</style>
