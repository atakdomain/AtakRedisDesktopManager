<script lang="ts">
  // Seçim/klasör üzerinde hızlı toplu işlem: seçenekler + önizleme → çalıştır → ilerleme → sonuç.
  // Diyalog kendisi onaydır (sayı ve ilk adlar görünür); canlı ortamda bağlantı adı yazdırılır.
  // Çalışırken kapatmak işi durdurmaz: iş arka planda sürer, bitince bildirim gelir.
  import Download from "@lucide/svelte/icons/download";
  import Files from "@lucide/svelte/icons/files";
  import PencilLine from "@lucide/svelte/icons/pencil-line";
  import Timer from "@lucide/svelte/icons/timer";
  import Trash from "@lucide/svelte/icons/trash";
  import { onDestroy } from "svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { connections } from "$lib/state/connections.svelte";
  import Modal from "$lib/ui/Modal.svelte";
  import { runLabel } from "./execute.svelte";
  import { BulkFlow } from "./flow.svelte";
  import ActionOptions from "./options/ActionOptions.svelte";
  import PreviewPanel from "./preview/PreviewPanel.svelte";
  import JobProgress from "./run/JobProgress.svelte";
  import JobResult from "./run/JobResult.svelte";
  import { sourceLabel } from "./source";
  import type { BulkRequest } from "./state.svelte";

  let { request, onclose }: { request: BulkRequest; onclose: () => void } = $props();

  const ICONS = { delete: Trash, expire: Timer, rename: PencilLine, copy: Files, export: Download };

  // svelte-ignore state_referenced_locally
  const ws = request.ws;
  // svelte-ignore state_referenced_locally
  const flow = new BulkFlow(ws, request.action, request.source, { targetDb: ws.db === 0 ? 1 : 0, ...request.draft });

  let typed = $state("");
  let closing = false;
  let submit = $state<HTMLButtonElement>();

  // Seçimi silmede (sayı ve adlar görünür) Enter onaylasın: odak birincil düğmede; canlı ortamda yazılı onay alanında
  $effect(() => {
    if (request.action !== "delete" || request.source.kind !== "keys" || flow.confirmText || !submit) return;
    const button = submit;
    queueMicrotask(() => button.focus());
  });

  onDestroy(() => flow.dispose());

  $effect(() => {
    void flow.signature;
    void flow.needsPreview;
    flow.schedulePreview();
  });

  const action = $derived(flow.draft.action);
  const Icon = $derived(ICONS[action]);
  const conn = $derived(connections.byId(ws.connectionId));
  const subtitle = $derived(`${flow.source ? sourceLabel(flow.source) : ""} · ${conn?.name ?? ""} · db${ws.db}`);
  const typedOk = $derived(!flow.confirmText || typed.trim() === flow.confirmText);
  const danger = $derived(action === "delete" || (action === "copy" && flow.draft.moveKeys));
  const wide = $derived(action === "rename" || action === "copy");

  async function run(): Promise<void> {
    if (!flow.canRun || !typedOk) return;
    const job = await flow.run("inline");
    if (closing || !job) return;
    // Sorunsuz bittiyse diyalog kapanır (bildirim özetler); hata/iptal varsa sonuç gösterilir
    const clean = job.status === "done" && !job.summary?.cancelled && (job.summary?.failed ?? 0) === 0 && !flow.runError;
    if (clean) onclose();
  }

  function close(): void {
    closing = true;
    onclose();
  }
</script>

<Modal title={t(`bulk.actionTitles.${action}`)} {subtitle} size={wide ? "lg" : "md"} onclose={close}>
  {#snippet icon()}
    <span class="badge" class:danger><Icon size={16} /></span>
  {/snippet}

  {#if flow.phase === "edit"}
    <form
      id="bulk-dialog-form"
      class="body"
      onsubmit={(e) => {
        e.preventDefault();
        void run();
      }}
    >
      <ActionOptions {flow} />
      <PreviewPanel {flow} height={wide ? 260 : 200} />
      {#if flow.confirmText}
        <div class="field confirm">
          <label for="bulk-confirm-text">{t("bulk.run.typeName", { name: flow.confirmText })}</label>
          <input id="bulk-confirm-text" class="input mono" bind:value={typed} autocomplete="off" spellcheck="false" />
        </div>
      {/if}
      {#if flow.runError}<p class="error-text">{flow.runError}</p>{/if}
    </form>
  {:else if (flow.phase === "running" || flow.phase === "backup") && flow.job}
    <JobProgress job={flow.job} note={flow.phase === "backup" ? t("bulk.run.backupRunning") : undefined} />
  {:else if flow.job}
    <JobResult job={flow.job} error={flow.runError} />
  {/if}

  {#snippet footer()}
    {#if flow.phase === "edit"}
      <button class="btn" type="button" onclick={close}>{t("common.cancel")}</button>
      <button
        class="btn"
        class:primary={!danger}
        class:danger
        type="submit"
        bind:this={submit}
        form="bulk-dialog-form"
        disabled={!flow.canRun || !typedOk}
      >
        {flow.built.ok ? runLabel(flow.built.action, flow.count) : t("bulk.run.run")}
      </button>
    {:else if flow.phase === "running" || flow.phase === "backup"}
      <button class="btn" onclick={close}>{t("bulk.run.background")}</button>
    {:else}
      <button class="btn" onclick={() => flow.again()}>{t("bulk.run.newRun")}</button>
      <button class="btn primary" onclick={close}>{t("common.close")}</button>
    {/if}
  {/snippet}
</Modal>

<style>
  .body {
    display: flex;
    flex-direction: column;
    gap: 16px;
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

  .badge.danger {
    background: var(--danger-soft);
    color: var(--danger);
  }

  .confirm {
    padding: 10px 12px;
    border: 1px solid color-mix(in srgb, var(--danger) 35%, transparent);
    border-radius: var(--radius);
    background: var(--danger-soft);
  }
</style>
