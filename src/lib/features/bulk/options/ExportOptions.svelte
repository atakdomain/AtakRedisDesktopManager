<script lang="ts">
  import type { ExportFormat } from "$lib/api/types";
  import { t } from "$lib/i18n/index.svelte";
  import { connections } from "$lib/state/connections.svelte";
  import type { BulkFlow } from "../flow.svelte";
  import { exportFileName, pickSavePath } from "../files";

  let { flow }: { flow: BulkFlow } = $props();

  const FORMATS: { value: ExportFormat; label: () => string; hint: () => string }[] = [
    { value: "dump", label: () => t("bulk.options.formatDump"), hint: () => t("bulk.options.formatDumpHint") },
    { value: "json", label: () => t("bulk.options.formatJson"), hint: () => t("bulk.options.formatJsonHint") },
  ];

  async function browse(): Promise<void> {
    const name = connections.byId(flow.ws.connectionId)?.name ?? "redis";
    const path = await pickSavePath(t("bulk.run.pickExport"), exportFileName(name, flow.ws.db, flow.draft.format), flow.draft.format);
    if (path) flow.draft.path = path;
  }

  function setFormat(format: ExportFormat): void {
    flow.draft.format = format;
    // Seçilmiş yolun uzantısı biçimle uyuşmuyorsa düzelt
    const path = flow.draft.path;
    if (path) flow.draft.path = path.replace(/\.(jsonl|json)$/i, format === "dump" ? ".jsonl" : ".json");
  }
</script>

<div class="options">
  <div class="formats" role="radiogroup">
    {#each FORMATS as format (format.value)}
      <label class="format" class:on={flow.draft.format === format.value}>
        <input type="radio" name="bulk-export-format" checked={flow.draft.format === format.value} onchange={() => setFormat(format.value)} />
        <span class="text">
          <span class="name">{format.label()}</span>
          <span class="hint">{format.hint()}</span>
        </span>
      </label>
    {/each}
  </div>
  <div class="field">
    <label for="bulk-export-path">{t("bulk.options.path")}</label>
    <div class="row">
      <input id="bulk-export-path" class="input mono grow" spellcheck="false" placeholder={t("bulk.options.pathPlaceholder")} bind:value={flow.draft.path} />
      <button class="btn" onclick={browse}>{t("bulk.options.browse")}</button>
    </div>
  </div>
</div>

<style>
  .options {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .formats {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .format {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    cursor: pointer;
  }

  .format:hover {
    background: var(--bg-hover);
  }

  .format.on {
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  input[type="radio"] {
    margin-top: 3px;
    accent-color: var(--accent);
  }

  .text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .name {
    font-weight: 500;
  }
</style>
