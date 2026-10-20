<script lang="ts">
  // Toplu işlem sekmesi: desen tabanlı iş. Solda kaynak/işlem/seçenekler, sağda önizleme → ilerleme → sonuç.
  import Download from "@lucide/svelte/icons/download";
  import Files from "@lucide/svelte/icons/files";
  import Folder from "@lucide/svelte/icons/folder";
  import Layers from "@lucide/svelte/icons/layers";
  import ListChecks from "@lucide/svelte/icons/list-checks";
  import PencilLine from "@lucide/svelte/icons/pencil-line";
  import Search from "@lucide/svelte/icons/search";
  import Timer from "@lucide/svelte/icons/timer";
  import Trash from "@lucide/svelte/icons/trash";
  import { onDestroy, untrack } from "svelte";
  import type { KeyFilter } from "$lib/api/types";
  import { selectionSource } from "$lib/features/browser/actions";
  import FilterInput from "$lib/features/browser/search/FilterInput.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { connections } from "$lib/state/connections.svelte";
  import type { Tab, Workspace } from "$lib/state/workspace.svelte";
  import Segmented from "$lib/ui/Segmented.svelte";
  import { runLabel } from "./execute.svelte";
  import { BulkFlow, renamePreset } from "./flow.svelte";
  import { ACTION_KINDS, type ActionKind } from "./model/draft";
  import { folderFilter } from "./model/patterns";
  import ActionOptions from "./options/ActionOptions.svelte";
  import PreviewPanel from "./preview/PreviewPanel.svelte";
  import JobProgress from "./run/JobProgress.svelte";
  import JobResult from "./run/JobResult.svelte";
  import { filterSource, filterLabel, type SourceSpec } from "./source";
  import type { BulkTabData, TabSource } from "./state.svelte";

  let { ws, tab }: { ws: Workspace; tab: Tab } = $props();

  const ICONS = { delete: Trash, expire: Timer, rename: PencilLine, copy: Files, export: Download };

  // svelte-ignore state_referenced_locally
  const initial = tab.data as BulkTabData | undefined;
  // svelte-ignore state_referenced_locally
  const flow = new BulkFlow(ws, initial?.action ?? "delete", null, { targetDb: ws.db === 0 ? 1 : 0 });

  let sourceKind = $state<TabSource>("search");
  let folderPath = $state("");
  // svelte-ignore state_referenced_locally
  let searchFilter = $state<KeyFilter>(copyFilter(ws.filter));
  let appliedSeq = -1;

  onDestroy(() => flow.dispose());

  function copyFilter(filter: KeyFilter): KeyFilter {
    return { mode: filter.mode, term: filter.term, caseSensitive: filter.caseSensitive, types: [...filter.types] };
  }

  /** Sekme ön ayarı (klasörden / seçimden açılış); aynı sekme yeniden açılınca da uygulanır */
  function apply(data: BulkTabData | undefined): void {
    if (flow.phase === "running" || flow.phase === "backup") return;
    if (flow.phase === "result") flow.again();
    const hasSelection = ws.selection.size > 0 || ws.allMatching;
    sourceKind = data?.source ?? (hasSelection ? "selection" : "search");
    if (data?.folder !== undefined) folderPath = data.folder;
    if (data?.filter) searchFilter = copyFilter(data.filter);
    if (data?.action) flow.draft.action = data.action;
    if (flow.draft.action === "rename" && sourceKind === "folder" && folderPath) Object.assign(flow.draft, renamePreset(folderPath, ws.separator));
  }

  $effect(() => {
    const data = tab.data as BulkTabData | undefined;
    const seq = data?.seq ?? 0;
    if (seq === appliedSeq) return;
    appliedSeq = seq;
    untrack(() => apply(data));
  });

  const normalizedFolder = $derived.by(() => {
    let path = folderPath.trim();
    if (path.endsWith(ws.separator)) path = path.slice(0, -ws.separator.length);
    return path;
  });

  const source = $derived.by((): SourceSpec | null => {
    if (sourceKind === "selection") return selectionSource(ws);
    if (sourceKind === "folder") return normalizedFolder ? filterSource(folderFilter(normalizedFolder, ws.separator), normalizedFolder) : null;
    return filterSource(searchFilter);
  });

  $effect(() => {
    const next = source;
    if (untrack(() => flow.phase) === "edit") flow.setSource(next);
  });

  $effect(() => {
    void flow.signature;
    void flow.needsPreview;
    flow.schedulePreview(450);
  });

  // Klasör kaynağında yeniden adlandırmaya geçince önek ön ayarı
  $effect(() => {
    if (flow.draft.action !== "rename" || sourceKind !== "folder" || !normalizedFolder) return;
    untrack(() => {
      if (!flow.draft.oldPrefix) Object.assign(flow.draft, renamePreset(normalizedFolder, ws.separator));
    });
  });

  const conn = $derived(connections.byId(ws.connectionId));
  const sources = $derived<{ value: TabSource; label: string; icon: typeof Search }[]>([
    { value: "selection", label: t("bulk.source.selection"), icon: ListChecks },
    { value: "folder", label: t("bulk.source.folder"), icon: Folder },
    { value: "search", label: t("bulk.source.search"), icon: Search },
  ]);
  const danger = $derived(flow.draft.action === "delete" || (flow.draft.action === "copy" && flow.draft.moveKeys));
  const busy = $derived(flow.phase === "running" || flow.phase === "backup");

  function setAction(action: ActionKind): void {
    if (busy) return;
    if (flow.phase === "result") flow.again();
    flow.draft.action = action;
  }
</script>

<div class="bulk">
  <div class="layout">
    <aside class="config">
      <header class="head">
        <span class="logo"><Layers size={16} /></span>
        <div class="grow">
          <h2>{t("bulk.title")}</h2>
          <p class="sub truncate">
            {conn?.name ?? ""} · db{ws.db}
            {#if conn?.env === "production"}<span class="prod">{t("bulk.source.production")}</span>{/if}
          </p>
        </div>
      </header>

      <div class="scroll">
        <section>
          <h3><span class="step">1</span>{t("bulk.steps.source")}</h3>
          <Segmented options={sources} bind:value={sourceKind} size="sm" />
          {#if sourceKind === "selection"}
            {#if ws.allMatching}
              <p class="info">{t("bulk.source.allMatching")}<br /><code>{filterLabel(ws.filter)}</code></p>
            {:else if ws.selection.size > 0}
              <p class="info">{t("bulk.source.selectionKeys", { count: ws.selection.size })}</p>
            {:else}
              <p class="info muted">{t("bulk.source.selectionEmpty")}</p>
            {/if}
          {:else if sourceKind === "folder"}
            <div class="field">
              <label for="bulk-folder">{t("bulk.source.folderPath")}</label>
              <input id="bulk-folder" class="input mono" spellcheck="false" autocomplete="off" placeholder={t("bulk.source.folderPlaceholder")} bind:value={folderPath} />
              {#if normalizedFolder}
                <span class="hint">{t("bulk.source.folderHint", { pattern: `${normalizedFolder}${ws.separator}*` })}</span>
              {/if}
            </div>
          {:else}
            <FilterInput filter={searchFilter} onchange={(next) => (searchFilter = next)} debounce={350} />
            <button class="btn ghost sm self-start" onclick={() => (searchFilter = copyFilter(ws.filter))}>{t("bulk.source.useBrowserSearch")}</button>
          {/if}
        </section>

        <section>
          <h3><span class="step">2</span>{t("bulk.steps.action")}</h3>
          <div class="actions" role="radiogroup">
            {#each ACTION_KINDS as action (action)}
              {@const Icon = ICONS[action]}
              <button class="tile" class:on={flow.draft.action === action} class:danger={action === "delete"} role="radio" aria-checked={flow.draft.action === action} disabled={busy} onclick={() => setAction(action)}>
                <Icon size={15} />
                <span>{t(`bulk.actions.${action}`)}</span>
              </button>
            {/each}
          </div>
        </section>

        <section>
          <h3><span class="step">3</span>{t("bulk.steps.options")}</h3>
          <fieldset disabled={busy}>
            <ActionOptions {flow} />
          </fieldset>
        </section>
      </div>

      <footer class="run">
        {#if flow.blocker && flow.phase === "edit"}<span class="blocker">{flow.blocker}</span>{/if}
        {#if flow.runError && flow.phase === "edit"}<span class="error-text">{flow.runError}</span>{/if}
        <button
          class="btn"
          class:primary={!danger}
          class:danger
          disabled={!flow.canRun}
          onclick={() => void flow.run("dialog")}
        >
          {flow.built.ok ? runLabel(flow.built.action, flow.count) : t("bulk.run.run")}
        </button>
      </footer>
    </aside>

    <main class="output">
      {#if flow.phase === "edit"}
        <h3>{t("bulk.preview.title")}</h3>
        <div class="preview">
          <PreviewPanel {flow} />
        </div>
      {:else if busy && flow.job}
        <JobProgress job={flow.job} note={flow.phase === "backup" ? t("bulk.run.backupRunning") : undefined} />
        <p class="hint">{t("bulk.run.backgroundHint")}</p>
      {:else if flow.job}
        <JobResult job={flow.job} error={flow.runError} />
        <div class="row">
          <button class="btn" onclick={() => flow.again()}>{t("bulk.run.newRun")}</button>
        </div>
      {/if}
    </main>
  </div>
</div>

<style>
  /* Sekme alanı dar olabilir (gezgin geniş): yerleşim pencereye değil sekmenin genişliğine göre */
  .bulk {
    container-type: inline-size;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }

  .layout {
    display: flex;
    height: 100%;
    min-height: 0;
  }

  .config {
    display: flex;
    flex-direction: column;
    width: 360px;
    flex: none;
    min-height: 0;
    border-right: 1px solid var(--border);
    background: var(--bg-sunken);
  }

  .head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 16px 10px;
  }

  .logo {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    flex: none;
    border-radius: 9px;
    background: var(--accent-soft);
    color: var(--accent-text);
  }

  h2 {
    font-size: var(--fs-md);
    font-weight: 600;
  }

  .sub {
    color: var(--text-3);
    font-size: var(--fs-xs);
  }

  .prod {
    margin-left: 4px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--danger);
    color: #fff;
    font-size: var(--fs-2xs);
    font-weight: 700;
    letter-spacing: 0.04em;
  }

  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 4px 16px 16px;
  }

  section {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 0 16px;
    border-bottom: 1px solid var(--border-subtle);
  }

  section:last-child {
    border-bottom: 0;
  }

  h3 {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-2);
  }

  .step {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--bg-active);
    color: var(--text-2);
    font-size: var(--fs-2xs);
    font-weight: 700;
  }

  .info {
    font-size: var(--fs-sm);
    line-height: 1.5;
  }

  .info code {
    color: var(--accent-text);
  }

  .self-start {
    align-self: flex-start;
  }

  .actions {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
  }

  .tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-height: 54px;
    padding: 6px 4px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-elevated);
    color: var(--text-2);
    font-size: var(--fs-xs);
    font-weight: 500;
    text-align: center;
    cursor: pointer;
  }

  .tile:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text);
  }

  .tile.on {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent-text);
    font-weight: 600;
  }

  .tile.on.danger {
    border-color: var(--danger);
    background: var(--danger-soft);
    color: var(--danger);
  }

  .tile:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  fieldset {
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
  }

  .run {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
    padding: 12px 16px;
    border-top: 1px solid var(--border);
  }

  .blocker {
    color: var(--text-3);
    font-size: var(--fs-xs);
  }

  .output {
    display: flex;
    flex-direction: column;
    gap: 12px;
    flex: 1;
    min-width: 0;
    min-height: 0;
    padding: 16px 20px;
    overflow: auto;
  }

  .output h3 {
    color: var(--text);
    font-size: var(--fs-md);
  }

  .preview {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .preview :global(.panel) {
    flex: 1;
  }

  @container (max-width: 760px) {
    .layout {
      flex-direction: column;
      height: 100%;
      overflow-y: auto;
    }

    .config {
      width: auto;
      flex: none;
      border-right: 0;
      border-bottom: 1px solid var(--border);
    }

    .scroll {
      overflow: visible;
    }

    .output {
      flex: none;
      min-height: 420px;
      overflow: visible;
    }
  }
</style>
