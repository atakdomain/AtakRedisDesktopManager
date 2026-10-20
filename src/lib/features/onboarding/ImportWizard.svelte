<script lang="ts">
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import FileUp from "@lucide/svelte/icons/file-up";
  import FolderSearch from "@lucide/svelte/icons/folder-search";
  import KeyRound from "@lucide/svelte/icons/key-round";
  import Plus from "@lucide/svelte/icons/plus";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import { onMount } from "svelte";
  import appIcon from "../../../../src-tauri/icons/icon.svg?url";
  import { api, ApiError } from "$lib/api";
  import type { AppInfo, ConnectionConfig, ImportCandidate, ImportWarning } from "$lib/api/types";
  import { connectTo, editConnection } from "$lib/features/connections/actions.svelte";
  import { address, displayName } from "$lib/features/connections/connectionInfo";
  import { pickFile } from "$lib/features/connections/files";
  import { fmtNumber, t } from "$lib/i18n/index.svelte";
  import { connections, emptyConnection } from "$lib/state/connections.svelte";
  import { settings } from "$lib/state/settings.svelte";
  import { toast, toastError } from "$lib/state/toasts.svelte";
  import { ui } from "$lib/state/ui.svelte";
  import Modal from "$lib/ui/Modal.svelte";
  import Segmented from "$lib/ui/Segmented.svelte";
  import Spinner from "$lib/ui/Spinner.svelte";
  import { tooltip } from "$lib/ui/tooltip.svelte";
  import { ardm, detectArdm } from "./ardm.svelte";
  import { defaultAction, IMPORT_GROUP, isIncluded, planImport, type ImportPlan, type RowAction } from "./importPlan";

  type Step = "detect" | "review" | "importing" | "done";
  type DupAction = Exclude<RowAction, "import">;

  // Açılış anındaki durum: ilk açılışta karşılama dili, sonra düz "içe aktar"
  const firstRun = !settings.onboardingDone && connections.list.length === 0;

  let step = $state<Step>("detect");
  let source = $state<{ kind: "ardm" | "file"; path: string } | null>(null);
  let candidates = $state.raw<ImportCandidate[]>([]);
  let actions = $state<RowAction[]>([]);
  /** Yinelenen satırda kutu yeniden işaretlenince dönülecek seçim */
  let lastDupChoice = $state<Record<number, DupAction>>({});
  let putInGroup = $state(false);
  let importError = $state<ApiError | null>(null);
  let platform = $state<AppInfo["platform"] | null>(null);
  let result = $state.raw<{ plan: ImportPlan; saved: ConnectionConfig[] } | null>(null);
  let allBox = $state<HTMLInputElement>();

  onMount(() => {
    void detectArdm(true);
    api.app
      .info()
      .then((info) => (platform = info.platform))
      .catch(() => undefined);
  });

  const scan = $derived(ardm.scan);
  const found = $derived(scan && scan.candidates.length > 0 ? scan : null);
  const foundDupes = $derived(found ? found.candidates.filter((c) => c.duplicateOf).length : 0);
  const detectError = $derived(ardm.error?.message || scan?.error || "");
  // İlk sonuç gelene dek "aranıyor" (bir kare bile "bulunamadı" görünmesin)
  const searching = $derived(ardm.loading || (!ardm.scan && !ardm.error));

  // ───────────── inceleme ─────────────

  const plan = $derived(planImport(candidates, actions, connections.list, { group: putInGroup }));
  const plainRows = $derived(candidates.map((_, i) => i).filter((i) => !candidates[i].duplicateOf));
  const dupRows = $derived(candidates.map((_, i) => i).filter((i) => candidates[i].duplicateOf));
  const allChecked = $derived(plainRows.length > 0 && plainRows.every((i) => actions[i] === "import"));
  const someChecked = $derived(plainRows.some((i) => actions[i] === "import"));
  const dupAll = $derived.by((): DupAction | "" => {
    const set = new Set(dupRows.map((i) => actions[i]));
    return set.size === 1 ? ([...set][0] as DupAction) : "";
  });
  const warnedRows = $derived(plan.rows.filter((row) => candidates[row].warnings.length > 0).length);

  $effect(() => {
    if (allBox) allBox.indeterminate = someChecked && !allChecked;
  });

  const dupOptions = $derived([
    { value: "skip" as DupAction, label: t("onboarding.review.actions.skip") },
    { value: "replace" as DupAction, label: t("onboarding.review.actions.replace"), title: t("onboarding.review.replaceHint") },
    { value: "keepBoth" as DupAction, label: t("onboarding.review.actions.keepBoth") },
  ]);

  function startReview(list: ImportCandidate[], from: { kind: "ardm" | "file"; path: string }) {
    // Paylaşılan durumdan gelen adaylar vekil (proxy) olabilir; plan structuredClone kullanır
    candidates = $state.snapshot(list);
    actions = list.map(defaultAction);
    lastDupChoice = {};
    source = from;
    importError = null;
    step = "review";
  }

  function toggleAll() {
    const next = !allChecked;
    for (const i of plainRows) actions[i] = next ? "import" : "skip";
  }

  function toggleRow(i: number) {
    if (!candidates[i].duplicateOf) {
      actions[i] = actions[i] === "import" ? "skip" : "import";
      return;
    }
    if (actions[i] === "skip") actions[i] = lastDupChoice[i] ?? "replace";
    else actions[i] = "skip";
  }

  function setDup(i: number, action: DupAction) {
    actions[i] = action;
    if (action !== "skip") lastDupChoice[i] = action;
  }

  function setAllDup(action: DupAction) {
    for (const i of dupRows) setDup(i, action);
  }

  function existingName(id: string): string {
    const c = connections.byId(id);
    return c ? displayName(c) : id;
  }

  function badges(c: ConnectionConfig): string[] {
    const out: string[] = [];
    if (c.mode === "cluster") out.push(t("connections.badges.cluster"));
    if (c.mode === "sentinel") out.push(t("connections.badges.sentinel"));
    if (c.ssh.enabled) out.push("SSH");
    if (c.tls.enabled) out.push("TLS");
    if (c.readOnly) out.push(t("connections.badges.readOnly"));
    return out;
  }

  function warningText(w: ImportWarning): string {
    return t(`onboarding.review.warnings.${w.code}`, { detail: w.detail });
  }

  // ───────────── adımlar ─────────────

  async function fromFile() {
    let path: string | null;
    try {
      path = await pickFile({
        title: t("onboarding.detect.fileTitle"),
        filters: [
          { name: t("onboarding.detect.fileFilter"), extensions: ["ardm", "json"] },
          { name: t("connections.editor.allFiles"), extensions: ["*"] },
        ],
      });
    } catch (err) {
      toastError(err);
      return;
    }
    if (!path) return;
    try {
      const list = await api.importer.ardmReadFile(path);
      if (list.length === 0) {
        toast("warning", t("onboarding.detect.fileEmpty"), { message: path });
        return;
      }
      startReview(list, { kind: "file", path });
    } catch (err) {
      toastError(err, t("onboarding.detect.readFailed"));
    }
  }

  async function runImport() {
    if (plan.configs.length === 0) return;
    const current = plan;
    step = "importing";
    importError = null;
    try {
      const saved = await connections.saveMany(current.configs);
      result = { plan: current, saved };
      settings.onboardingDone = true;
      step = "done";
      // Ana sayfadaki "yeni bağlantı" sayısı ve yinelenenler tazelensin
      void detectArdm(true);
    } catch (err) {
      importError = err instanceof ApiError ? err : new ApiError("internal", String(err));
      step = "review";
    }
  }

  const needsAttention = $derived(
    result
      ? result.plan.rows
          .map((row, i) => ({ config: result!.saved[i], warnings: candidates[row].warnings }))
          .filter((x) => x.config && x.warnings.length > 0)
      : [],
  );
  const firstSaved = $derived(result?.saved[0]);

  function finish() {
    settings.onboardingDone = true;
    ui.importOpen = false;
  }

  function close() {
    if (step !== "importing") finish();
  }

  function newConnection() {
    finish();
    ui.connectionEditor = emptyConnection();
  }

  function connectFirst() {
    const first = firstSaved;
    finish();
    if (first) connectTo(first.id);
  }

  function editSaved(c: ConnectionConfig) {
    finish();
    editConnection(c);
  }

  const ardmFolders: { platform: AppInfo["platform"]; path: string }[] = [
    { platform: "windows", path: "%APPDATA%\\another-redis-desktop-manager" },
    { platform: "linux", path: "~/.config/another-redis-desktop-manager" },
    { platform: "macos", path: "~/Library/Application Support/another-redis-desktop-manager" },
  ];
  const shownFolders = $derived(platform ? ardmFolders.filter((f) => f.platform === platform) : ardmFolders);

  /** Adım değişince birincil düğme odak alır: Enter ile ilerlenir */
  function focusOnMount(el: HTMLElement) {
    el.focus();
  }

  const title = $derived(firstRun ? t("onboarding.welcomeTitle") : t("onboarding.importTitle"));
</script>

<Modal {title} subtitle={firstRun ? undefined : t("onboarding.subtitle")} size="lg" dismissible={step !== "importing"} onclose={close}>
  {#if step === "detect"}
    <div class="detect">
      <div class="hero">
        <img src={appIcon} alt="" width="48" height="48" />
        <div>
          <h3>{t("onboarding.hero.title")}</h3>
          <p>{t("onboarding.hero.text")}</p>
        </div>
      </div>

      {#if searching && !found}
        <div class="card">
          <span class="card-icon"><Spinner size={18} /></span>
          <div class="card-text"><div class="card-title">{t("onboarding.detect.searching")}</div></div>
        </div>
      {:else if found}
        <div class="card good">
          <span class="card-icon"><CircleCheck size={20} /></span>
          <div class="card-text">
            <div class="card-title">
              {t("onboarding.detect.found", { count: found.candidates.length })}
              {#if foundDupes > 0}<span class="muted">· {t("onboarding.detect.alreadyHere", { count: foundDupes })}</span>{/if}
            </div>
            <div class="path mono truncate selectable" use:tooltip={found.source}>{found.source}</div>
          </div>
        </div>
      {:else if detectError}
        <div class="card bad">
          <span class="card-icon"><CircleAlert size={20} /></span>
          <div class="card-text">
            <div class="card-title">{t("onboarding.detect.errorTitle")}</div>
            <pre class="raw mono selectable">{detectError}</pre>
            <div class="hint">{t("onboarding.detect.errorHint")}</div>
          </div>
          <button class="btn sm" onclick={() => detectArdm(true)}><RefreshCw size={13} />{t("onboarding.detect.retry")}</button>
        </div>
      {:else}
        <div class="card">
          <span class="card-icon"><FolderSearch size={20} /></span>
          <div class="card-text">
            <div class="card-title">{t("onboarding.detect.noneTitle")}</div>
            <div class="hint">{t("onboarding.detect.noneText")}</div>
            <ul class="folders">
              {#each shownFolders as folder (folder.platform)}<li class="mono selectable">{folder.path}</li>{/each}
            </ul>
            <div class="hint">{t("onboarding.detect.otherMachine")}</div>
          </div>
          <button class="btn sm ghost" aria-label={t("onboarding.detect.retry")} use:tooltip={t("onboarding.detect.retry")} onclick={() => detectArdm(true)}>
            <RefreshCw size={13} />
          </button>
        </div>
      {/if}

      <button class="link" onclick={fromFile}><FileUp size={14} />{t("onboarding.detect.fromFile")}</button>
    </div>
  {:else if step === "review" || step === "importing"}
    <div class="review">
      {#if source}
        <div class="source">
          <span class="muted">{t("onboarding.review.source")}</span>
          <span class="mono truncate selectable" use:tooltip={source.path}>{source.path}</span>
        </div>
      {/if}

      {#if dupRows.length > 0}
        <div class="dups">
          <TriangleAlert size={14} />
          <span class="grow">{t("onboarding.review.duplicates", { count: dupRows.length })}</span>
          <span class="muted">{t("onboarding.review.forAll")}</span>
          <Segmented size="sm" options={dupOptions} value={dupAll as DupAction} onchange={setAllDup} />
        </div>
      {/if}

      <div class="table-wrap">
        <table>
          <colgroup>
            <col style="width: 34px" />
            <col />
            <col style="width: 30%" />
            <col style="width: 150px" />
          </colgroup>
          <thead>
            <tr>
              <th>
                {#if plainRows.length > 0}
                  <input bind:this={allBox} type="checkbox" class="checkbox" checked={allChecked} aria-label={t("onboarding.review.selectAll")} onchange={toggleAll} />
                {/if}
              </th>
              <th>{t("onboarding.review.columns.name")}</th>
              <th>{t("onboarding.review.columns.address")}</th>
              <th>{t("onboarding.review.columns.details")}</th>
            </tr>
          </thead>
          <tbody>
            {#each candidates as candidate, i (i)}
              {@const c = candidate.config}
              {@const included = isIncluded(actions[i])}
              <tr class:off={!included}>
                <td>
                  <input id="iw-row-{i}" type="checkbox" class="checkbox" checked={included} onchange={() => toggleRow(i)} />
                </td>
                <td>
                  <label for="iw-row-{i}" class="name-cell">
                    <span class="name truncate">{displayName(c)}</span>
                    {#if candidate.warnings.length}
                      <span class="warn-icon" use:tooltip={candidate.warnings.map(warningText).join(" · ")}><TriangleAlert size={13} /></span>
                    {/if}
                  </label>
                  {#if candidate.duplicateOf}
                    <div class="dup-line">
                      <span class="muted truncate">{t("onboarding.review.exists", { name: existingName(candidate.duplicateOf) })}</span>
                      <select class="select sm" value={actions[i]} onchange={(e) => setDup(i, (e.currentTarget as HTMLSelectElement).value as DupAction)} aria-label={t("onboarding.review.exists", { name: existingName(candidate.duplicateOf) })}>
                        {#each dupOptions as option (option.value)}<option value={option.value}>{option.label}</option>{/each}
                      </select>
                    </div>
                  {/if}
                </td>
                <td class="mono addr truncate">{address(c)}{c.db ? ` /${c.db}` : ""}</td>
                <td>
                  <div class="badges">
                    {#each badges(c) as badge (badge)}<span class="pill">{badge}</span>{/each}
                    {#if c.password}<span class="pill icon-pill" use:tooltip={t("connections.badges.password")}><KeyRound size={10} /></span>{/if}
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <div class="options">
        <label class="check">
          <input type="checkbox" bind:checked={putInGroup} />
          {t("onboarding.review.group", { group: IMPORT_GROUP })}
        </label>
        {#if warnedRows > 0}
          <p class="note"><TriangleAlert size={13} />{t("onboarding.review.warningsNote", { count: warnedRows })}</p>
        {/if}
        {#if importError}
          <p class="error-box" role="alert"><CircleAlert size={14} /><span><strong>{t("onboarding.importFailed")}</strong> <span class="selectable">{importError.message}</span></span></p>
        {/if}
      </div>
    </div>
  {:else if step === "done" && result}
    <div class="done">
      <span class="done-icon"><CircleCheck size={28} /></span>
      <h3>
        {#if result.plan.added > 0}
          {t("onboarding.done.added", { count: result.plan.added })}
        {:else if result.plan.replaced > 0}
          {t("onboarding.done.replaced", { count: result.plan.replaced })}
        {:else}
          {t("onboarding.done.nothing")}
        {/if}
      </h3>
      <p class="muted">
        {[result.plan.added > 0 && result.plan.replaced > 0 ? t("onboarding.done.replaced", { count: result.plan.replaced }) : "", result.plan.skipped > 0 ? t("onboarding.done.skipped", { count: result.plan.skipped }) : ""]
          .filter(Boolean)
          .join(" · ")}
      </p>

      {#if needsAttention.length}
        <div class="attention">
          <div class="attention-head"><TriangleAlert size={14} />{t("onboarding.done.attention")}</div>
          <p class="hint">{t("onboarding.done.attentionText")}</p>
          <ul>
            {#each needsAttention as item (item.config.id)}
              <li>
                <div class="grow">
                  <div class="truncate">{displayName(item.config)}</div>
                  {#each item.warnings as warning, w (w)}<div class="hint mono truncate">{warningText(warning)}</div>{/each}
                </div>
                <button class="btn sm" onclick={() => editSaved(item.config)}>{t("onboarding.done.edit")}</button>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>
  {/if}

  {#snippet footer()}
    {#if step === "detect"}
      <button class="btn ghost" onclick={finish}>{firstRun ? t("onboarding.skip") : t("common.cancel")}</button>
      <span class="grow"></span>
      {#if found}
        <button class="btn primary" {@attach focusOnMount} onclick={() => startReview(found.candidates, { kind: "ardm", path: found.source })}>
          {t("common.continue")}
        </button>
      {:else if !searching}
        <button class="btn" onclick={fromFile}><FileUp size={14} />{t("onboarding.detect.fromFile")}</button>
        <button class="btn primary" onclick={newConnection}><Plus size={14} />{t("onboarding.newConnection")}</button>
      {/if}
    {:else if step === "review" || step === "importing"}
      <button class="btn ghost" onclick={() => (step = "detect")} disabled={step === "importing"}><ArrowLeft size={14} />{t("common.back")}</button>
      <span class="grow summary muted">{t("onboarding.review.summary", { selected: fmtNumber(plan.configs.length), total: fmtNumber(candidates.length) })}</span>
      <button class="btn primary" {@attach focusOnMount} onclick={runImport} disabled={plan.configs.length === 0 || step === "importing"}>
        {#if step === "importing"}
          <Spinner size={13} />{t("onboarding.importing")}
        {:else if plan.configs.length === 0}
          {t("onboarding.review.nothing")}
        {:else}
          {t("onboarding.review.import", { count: plan.configs.length })}
        {/if}
      </button>
    {:else}
      <button class="btn" onclick={finish}>{t("common.done")}</button>
      {#if firstSaved}
        <button class="btn primary" {@attach focusOnMount} onclick={connectFirst}>{t("onboarding.done.connectTo", { name: displayName(firstSaved) })}</button>
      {/if}
    {/if}
  {/snippet}
</Modal>

<style>
  /* ───── algılama ───── */
  .detect {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding-top: 4px;
  }

  .hero {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .hero img {
    flex: none;
    filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.18));
  }

  .hero h3 {
    font-size: var(--fs-md);
    font-weight: 600;
  }

  .hero p {
    margin-top: 4px;
    color: var(--text-2);
    line-height: 1.55;
  }

  .card {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    min-height: 64px;
    padding: 14px 14px 14px 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-sunken);
  }

  .card.good {
    border-color: color-mix(in srgb, var(--success) 35%, var(--border));
    background: var(--success-soft);
  }

  .card.bad {
    border-color: color-mix(in srgb, var(--danger) 35%, var(--border));
    background: var(--danger-soft);
  }

  .card-icon {
    display: grid;
    place-items: center;
    flex: none;
    width: 22px;
    height: 22px;
    color: var(--text-3);
  }

  .good .card-icon {
    color: var(--success);
  }

  .bad .card-icon {
    color: var(--danger);
  }

  .card-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .card-title {
    font-weight: 600;
    line-height: 22px;
  }

  .card-title .muted {
    font-weight: 400;
  }

  .path {
    color: var(--text-2);
    font-size: var(--fs-xs);
  }

  .raw {
    margin: 2px 0;
    padding: 6px 8px;
    max-height: 90px;
    overflow: auto;
    border-radius: var(--radius);
    background: var(--bg-elevated);
    white-space: pre-wrap;
    word-break: break-word;
    font-size: var(--fs-xs);
  }

  .folders {
    margin: 2px 0 4px;
    padding: 0;
    list-style: none;
  }

  .folders li {
    display: inline-block;
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
    font-size: var(--fs-xs);
  }

  .hint {
    line-height: 1.5;
  }

  .link {
    display: inline-flex;
    align-self: flex-start;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
    border: 0;
    background: none;
    color: var(--accent-text);
    font-weight: 500;
    cursor: pointer;
  }

  .link:hover {
    text-decoration: underline;
  }

  /* ───── inceleme ───── */
  .review {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .source {
    display: flex;
    gap: 8px;
    min-width: 0;
    font-size: var(--fs-xs);
  }

  .source .mono {
    color: var(--text-2);
    font-size: var(--fs-xs);
  }

  .dups {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 6px 6px 10px;
    border-radius: var(--radius);
    background: var(--warning-soft);
    color: var(--text);
    font-size: var(--fs-sm);
  }

  .dups > :global(svg) {
    flex: none;
    color: var(--warning);
  }

  .table-wrap {
    max-height: 340px;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }

  th {
    position: sticky;
    top: 0;
    z-index: 1;
    height: 30px;
    padding: 0 8px;
    background: var(--bg-sunken);
    border-bottom: 1px solid var(--border);
    color: var(--text-3);
    font-size: var(--fs-xs);
    font-weight: 600;
    text-align: left;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }

  td {
    height: 36px;
    padding: 5px 8px;
    border-bottom: 1px solid var(--border-subtle);
    vertical-align: middle;
  }

  th:first-child,
  td:first-child {
    padding-left: 12px;
    padding-right: 0;
  }

  tbody tr:last-child td {
    border-bottom: 0;
  }

  tbody tr:hover {
    background: var(--bg-hover);
  }

  tr.off .name,
  tr.off .addr,
  tr.off .badges {
    opacity: 0.5;
  }

  .name-cell {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    cursor: pointer;
  }

  .name {
    font-weight: 500;
  }

  .warn-icon {
    display: inline-grid;
    flex: none;
    color: var(--warning);
  }

  .dup-line {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 3px;
    font-size: var(--fs-xs);
  }

  .dup-line .muted {
    flex: 1;
    min-width: 0;
  }

  .dup-line .select {
    flex: none;
    width: auto;
    height: 22px;
    font-size: var(--fs-xs);
  }

  .addr {
    color: var(--text-2);
  }

  .badges {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    height: 18px;
    padding: 0 6px;
    border-radius: 4px;
    background: var(--bg-active);
    color: var(--text-2);
    font-size: var(--fs-2xs);
    font-weight: 600;
  }

  .icon-pill {
    padding: 0 4px;
  }

  .options {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-top: 2px;
  }

  .note {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-2);
    font-size: var(--fs-sm);
  }

  .note :global(svg) {
    flex: none;
    color: var(--warning);
  }

  .error-box {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 10px;
    border-radius: var(--radius);
    background: var(--danger-soft);
    color: var(--danger);
    font-size: var(--fs-sm);
  }

  .error-box :global(svg) {
    flex: none;
    margin-top: 2px;
  }

  .summary {
    font-size: var(--fs-sm);
  }

  /* ───── bitti ───── */
  .done {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 16px 0 8px;
    text-align: center;
  }

  .done-icon {
    display: grid;
    place-items: center;
    width: 56px;
    height: 56px;
    margin-bottom: 12px;
    border-radius: 50%;
    background: var(--success-soft);
    color: var(--success);
  }

  .done h3 {
    font-size: var(--fs-lg);
    font-weight: 600;
  }

  .done > p {
    margin-top: 4px;
    min-height: 1.45em;
  }

  .attention {
    width: 100%;
    margin-top: 18px;
    padding: 12px 14px;
    border: 1px solid color-mix(in srgb, var(--warning) 35%, var(--border));
    border-radius: var(--radius-lg);
    background: var(--warning-soft);
    text-align: left;
  }

  .attention-head {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
  }

  .attention-head :global(svg) {
    color: var(--warning);
  }

  .attention ul {
    margin: 8px 0 0;
    padding: 0;
    list-style: none;
  }

  .attention li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 0;
    border-top: 1px solid color-mix(in srgb, var(--warning) 20%, transparent);
  }
</style>
