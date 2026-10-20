<script lang="ts">
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import CornerDownLeft from "@lucide/svelte/icons/corner-down-left";
  import Link from "@lucide/svelte/icons/link";
  import Route from "@lucide/svelte/icons/route";
  import Server from "@lucide/svelte/icons/server";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import Zap from "@lucide/svelte/icons/zap";
  import { tick } from "svelte";
  import { api, ApiError } from "$lib/api";
  import type { ConnectionConfig, TestResult } from "$lib/api/types";
  import { t } from "$lib/i18n/index.svelte";
  import { connections, emptyConnection } from "$lib/state/connections.svelte";
  import { confirm, dialogQueue } from "$lib/state/dialogs.svelte";
  import { ui } from "$lib/state/ui.svelte";
  import Kbd from "$lib/ui/Kbd.svelte";
  import Modal from "$lib/ui/Modal.svelte";
  import Spinner from "$lib/ui/Spinner.svelte";
  import { tooltip } from "$lib/ui/tooltip.svelte";
  import { fmtDuration } from "$lib/util/format";
  import { connectTo } from "./actions.svelte";
  import { displayName } from "./connectionInfo";
  import GeneralSection from "./editor/GeneralSection.svelte";
  import SshSection from "./editor/SshSection.svelte";
  import TlsSection from "./editor/TlsSection.svelte";
  import { FIELD_ORDER, FIELD_SECTION, normalizeConnection, validateConnection, type Field, type Section } from "./editor/validate";
  import { describeConnectionError } from "./errors";
  import { applyRedisUrl, formatRedisUrl, parseRedisUrl } from "./redisUrl";

  const source: ConnectionConfig = $state.snapshot(ui.connectionEditor) ?? emptyConnection();
  const isNew = source.id === "";

  let form = $state<ConnectionConfig>(structuredClone(source));
  const initialJson = JSON.stringify(source);
  const formJson = $derived(JSON.stringify(form));
  const dirty = $derived(formJson !== initialJson);

  let section = $state<Section>("general");
  let attempted = $state(false);
  let touched = $state<Partial<Record<Field, boolean>>>({});
  const errors = $derived(validateConnection(form));
  const hasErrors = $derived(Object.keys(errors).length > 0);

  // Düzenlemede adres alanı istenince açılır; yeni bağlantıda baştan görünür
  let showUrl = $state(isNew);
  let urlText = $state("");
  let urlNote = $state<{ ok: boolean; text: string } | null>(null);

  let saving = $state(false);
  let saveError = $state<ApiError | null>(null);

  type TestState = { state: "running" } | { state: "ok"; result: TestResult } | { state: "error"; error: ApiError };
  let test = $state<(TestState & { json: string }) | null>(null);
  let testSeq = 0;
  // Sonuç yalnızca denenen ayarlar değişmediyse gösterilir
  const testShown = $derived(test && test.json === formJson ? test : null);

  function err(field: Field): string | null {
    const key = errors[field];
    return key && (attempted || touched[field]) ? t(key) : null;
  }

  function touch(field: Field) {
    touched[field] = true;
  }

  function sectionHasError(s: Section): boolean {
    return attempted && FIELD_ORDER.some((f) => FIELD_SECTION[f] === s && errors[f]);
  }

  const sections = $derived([
    { id: "general" as Section, label: t("connections.editor.sections.general"), icon: Server, on: false },
    { id: "tls" as Section, label: t("connections.editor.sections.tls"), icon: ShieldCheck, on: form.tls.enabled },
    { id: "ssh" as Section, label: t("connections.editor.sections.ssh"), icon: Route, on: form.ssh.enabled },
  ]);

  // ───────────── adres yapıştırma ─────────────

  function applyUrl(text = urlText): boolean {
    if (!text.trim()) return false;
    const parsed = parseRedisUrl(text);
    if (!parsed) {
      urlNote = { ok: false, text: t("connections.editor.urlInvalid") };
      return false;
    }
    applyRedisUrl(form, parsed);
    urlText = "";
    urlNote = { ok: true, text: t("connections.editor.urlApplied", { url: formatRedisUrl(form) }) };
    return true;
  }

  function onUrlPaste(e: ClipboardEvent) {
    const text = e.clipboardData?.getData("text") ?? "";
    if (!urlText.trim() && parseRedisUrl(text)) {
      e.preventDefault();
      applyUrl(text);
    }
  }

  function onUrlKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !(e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      applyUrl();
    }
  }

  async function revealUrl() {
    showUrl = true;
    await tick();
    document.getElementById("ce-url")?.focus();
  }

  // ───────────── kaydet / dene ─────────────

  async function revealFirstError(): Promise<void> {
    const first = FIELD_ORDER.find((f) => errors[f]);
    if (!first) return;
    section = FIELD_SECTION[first];
    await tick();
    document.getElementById(`ce-${first}`)?.focus();
  }

  async function save(connect: boolean) {
    if (saving) return;
    attempted = true;
    saveError = null;
    if (hasErrors) {
      await revealFirstError();
      return;
    }
    saving = true;
    try {
      const saved = await connections.save(normalizeConnection($state.snapshot(form)));
      ui.connectionEditor = null;
      // Kayıtlı ve açık bir bağlantıyı kaydetmek zaten yeniden bağlanır
      if (connect && connections.status[saved.id] !== "connecting") connectTo(saved.id);
    } catch (e) {
      saveError = e instanceof ApiError ? e : new ApiError("internal", String(e));
    } finally {
      saving = false;
    }
  }

  async function runTest() {
    attempted = true;
    if (hasErrors) {
      await revealFirstError();
      return;
    }
    const seq = ++testSeq;
    const json = formJson;
    test = { state: "running", json };
    try {
      const result = await api.connections.test(normalizeConnection($state.snapshot(form)));
      if (seq === testSeq) test = { state: "ok", result, json };
    } catch (e) {
      if (seq === testSeq) test = { state: "error", error: e instanceof ApiError ? e : new ApiError("internal", String(e)), json };
    }
  }

  async function close() {
    if (saving) return;
    if (dirty) {
      const discard = await confirm({
        title: t("connections.editor.discard.title"),
        message: t("connections.editor.discard.message"),
        confirmLabel: t("connections.editor.discard.confirm"),
        danger: true,
      });
      if (!discard) return;
    }
    ui.connectionEditor = null;
  }

  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && dialogQueue.length === 0) {
      e.preventDefault();
      void save(true);
    }
  }

  function modeLabel(mode: string): string {
    return mode === "standalone" || mode === "cluster" || mode === "sentinel" ? t(`connections.modes.${mode}`) : mode;
  }

  const testError = $derived(testShown?.state === "error" ? describeConnectionError(testShown.error, form) : null);
</script>

<svelte:window onkeydown={onWindowKeydown} />

<Modal title={isNew ? t("connections.editor.newTitle") : t("connections.editor.editTitle")} subtitle={isNew ? undefined : displayName(source)} size="lg" dismissible={!saving} onclose={close}>
  {#if showUrl}
    <div class="url" class:bad={urlNote && !urlNote.ok}>
      <label for="ce-url" class="url-label"><Link size={14} />{t("connections.editor.urlLabel")}</label>
      <div class="url-input">
        <input
          id="ce-url"
          class="input mono"
          bind:value={urlText}
          placeholder={t("connections.editor.urlPlaceholder")}
          spellcheck="false"
          autocomplete="off"
          onpaste={onUrlPaste}
          onkeydown={onUrlKeydown}
          oninput={() => (urlNote = null)}
          data-autofocus={isNew || undefined}
        />
        {#if urlText.trim()}
          <button type="button" class="apply" aria-label={t("connections.editor.urlApply")} use:tooltip={{ text: t("connections.editor.urlApply"), shortcut: "Enter" }} onclick={() => applyUrl()}>
            <CornerDownLeft size={13} />
          </button>
        {/if}
      </div>
      {#if urlNote}
        <span class="url-note" class:ok={urlNote.ok}>{urlNote.text}</span>
      {/if}
    </div>
  {/if}

  <div class="split">
    <nav class="nav" aria-label={t("connections.editor.editTitle")}>
      {#each sections as s (s.id)}
        <button type="button" class="nav-item" class:active={section === s.id} aria-current={section === s.id ? "page" : undefined} onclick={() => (section = s.id)}>
          <s.icon size={14} />
          <span class="grow truncate">{s.label}</span>
          {#if sectionHasError(s.id)}
            <span class="nav-error" aria-label={t("common.error")}></span>
          {:else if s.on}
            <span class="nav-on">{t("connections.editor.on")}</span>
          {/if}
        </button>
      {/each}
      {#if !showUrl}
        <button type="button" class="nav-item url-toggle" onclick={revealUrl}>
          <Link size={14} />
          <span class="grow truncate">{t("connections.editor.urlLabel")}</span>
        </button>
      {/if}
    </nav>

    <div class="pane">
      {#if section === "general"}
        <GeneralSection bind:form {err} {touch} autofocusName={!isNew} />
      {:else if section === "tls"}
        <TlsSection bind:form />
      {:else}
        <SshSection bind:form {err} {touch} />
      {/if}
    </div>
  </div>

  {#if saveError}
    <div class="save-error" role="alert">
      <CircleAlert size={14} />
      <span class="grow"><strong>{t("connections.editor.saveFailed")}</strong> <span class="selectable">{saveError.message}</span></span>
    </div>
  {:else if attempted && hasErrors}
    <div class="save-error" role="alert">
      <CircleAlert size={14} />
      <span class="grow">{t("connections.editor.validation.fixErrors")}</span>
    </div>
  {/if}

  {#snippet footer()}
    <button type="button" class="btn" onclick={runTest} disabled={testShown?.state === "running"}>
      {#if testShown?.state === "running"}<Spinner size={13} />{t("connections.editor.testing")}{:else}<Zap size={14} />{t("connections.editor.test")}{/if}
    </button>
    <div class="test-result" aria-live="polite">
      {#if testShown?.state === "ok"}
        <span class="ok truncate" use:tooltip={t("connections.editor.testOk")}>
          <CircleCheck size={14} />
          {t("connections.editor.testDetail", { version: testShown.result.serverVersion, mode: modeLabel(testShown.result.redisMode), latency: fmtDuration(testShown.result.latencyMs) })}
        </span>
      {:else if testShown?.state === "error" && testError}
        <span class="fail truncate" use:tooltip={testShown.error.message}>
          <CircleAlert size={14} />
          {testError.title}
        </span>
      {/if}
    </div>
    <button type="button" class="btn ghost" onclick={close} disabled={saving}>{t("common.cancel")}</button>
    <button type="button" class="btn" onclick={() => save(false)} disabled={saving}>{t("connections.editor.save")}</button>
    <button type="button" class="btn primary" onclick={() => save(true)} disabled={saving} use:tooltip={{ text: t("connections.editor.saveConnect"), shortcut: "Mod+Enter" }}>
      {#if saving}<Spinner size={13} />{/if}
      {t("connections.editor.saveConnect")}
      <span class="kbd-hint"><Kbd shortcut="Mod+Enter" subtle /></span>
    </button>
  {/snippet}
</Modal>

<style>
  /* ───── adresten doldur ───── */
  .url {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 4px 12px;
    padding: 10px 12px;
    margin-bottom: 16px;
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-lg);
    background: var(--bg-sunken);
  }

  .url.bad {
    border-color: var(--danger);
  }

  .url-label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-sm);
    font-weight: 500;
    color: var(--text-2);
    white-space: nowrap;
  }

  .url-input {
    position: relative;
  }

  .url-input .input {
    padding-right: 32px;
  }

  .apply {
    position: absolute;
    top: 3px;
    right: 3px;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border: 0;
    border-radius: var(--radius-sm);
    background: var(--accent-soft);
    color: var(--accent-text);
    cursor: pointer;
  }

  .url-note {
    grid-column: 2;
    font-size: var(--fs-xs);
    color: var(--danger);
    word-break: break-all;
  }

  .url-note.ok {
    color: var(--success);
  }

  /* ───── bölümler ───── */
  .split {
    display: grid;
    grid-template-columns: 150px minmax(0, 1fr);
    gap: 20px;
  }

  .nav {
    position: sticky;
    top: 0;
    align-self: start;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--radius);
    background: none;
    color: var(--text-2);
    font-size: var(--fs);
    font-weight: 500;
    text-align: left;
    cursor: pointer;
  }

  .nav-item:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .nav-item.active {
    background: var(--bg-selected);
    color: var(--text);
  }

  .url-toggle {
    margin-top: 8px;
    color: var(--text-3);
    font-weight: 400;
    font-size: var(--fs-sm);
  }

  .nav-on {
    padding: 0 6px;
    border-radius: 999px;
    background: var(--success-soft);
    color: var(--success);
    font-size: var(--fs-2xs);
    font-weight: 600;
    line-height: 16px;
  }

  .nav-error {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--danger);
  }

  .pane {
    min-width: 0;
    min-height: 470px;
  }

  .save-error {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-top: 16px;
    padding: 8px 10px;
    border-radius: var(--radius);
    background: var(--danger-soft);
    color: var(--danger);
    font-size: var(--fs-sm);
    line-height: 1.5;
  }

  .save-error :global(svg) {
    flex: none;
    margin-top: 2px;
  }

  /* ───── alt çubuk ───── */
  .test-result {
    flex: 1;
    min-width: 0;
    display: flex;
    font-size: var(--fs-sm);
  }

  .test-result span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 100%;
  }

  .test-result :global(svg) {
    flex: none;
  }

  .ok {
    color: var(--success);
  }

  .fail {
    color: var(--danger);
  }

  .kbd-hint {
    display: inline-flex;
    margin-right: -4px;
    opacity: 0.85;
  }

  .kbd-hint :global(.kbd) {
    color: rgba(255, 255, 255, 0.8);
  }
</style>
