<script lang="ts">
  // Yeni anahtar: ad (önek dolu, imleç sonda), tür, isteğe bağlı TTL ve türe göre ilk değer.
  // Enter gönderir; çok satırlı alanlarda Mod+Enter.
  import Lock from "@lucide/svelte/icons/lock";
  import { untrack } from "svelte";
  import { api, ApiError } from "$lib/api";
  import type { KeyType, NewKey } from "$lib/api/types";
  import { t } from "$lib/i18n/index.svelte";
  import { isMac } from "$lib/state/commands.svelte";
  import { connections } from "$lib/state/connections.svelte";
  import type { Workspace } from "$lib/state/workspace.svelte";
  import Modal from "$lib/ui/Modal.svelte";
  import Segmented from "$lib/ui/Segmented.svelte";
  import Spinner from "$lib/ui/Spinner.svelte";
  import { checkJson, looksLikeJsonContainer, minifyJson } from "./codec/json";
  import { describeError } from "./messages";
  import FieldRows, { type FieldRow } from "./table/FieldRows.svelte";
  import { parseTtl, type TtlUnit } from "./ttl";
  import CodeEditor from "./value/CodeEditor.svelte";

  /** `prefix`: klasörden açıldıysa ad öneki (ör. "user:") */
  let { ws, prefix = "", onclose }: { ws: Workspace; prefix?: string; onclose: () => void } = $props();

  type NewType = "string" | "hash" | "list" | "set" | "zset" | "stream" | "ReJSON-RL";

  const hasJson = $derived((connections.sessions[ws.connectionId]?.modules ?? []).some((m) => /json/i.test(m)));
  const types = $derived<{ value: NewType; label: string }[]>([
    { value: "string", label: t("common.types.string") },
    { value: "hash", label: t("common.types.hash") },
    { value: "list", label: t("common.types.list") },
    { value: "set", label: t("common.types.set") },
    { value: "zset", label: t("common.types.zset") },
    { value: "stream", label: t("common.types.stream") },
    ...(hasJson ? [{ value: "ReJSON-RL" as const, label: t("common.types.json") }] : []),
  ]);

  let name = $state(untrack(() => prefix));
  let type = $state<NewType>("string");
  let ttlText = $state("");
  let ttlUnit = $state<TtlUnit>("s");
  let field = $state("");
  let value = $state("");
  let score = $state("0");
  let streamId = $state("*");
  let rows = $state<FieldRow[]>([{ field: "", value: "" }]);
  let stringText = $state("");
  let jsonText = $state("{}");
  let stringLang = $state<"json" | "text">("text");

  let nameError = $state<string | null>(null);
  let error = $state<string | null>(null);
  let busy = $state(false);
  let nameInput = $state<HTMLInputElement>();
  let stringEditor = $state<CodeEditor>();
  let jsonEditor = $state<CodeEditor>();

  const ttlMs = $derived(ttlText.trim() ? parseTtl(ttlText, ttlUnit) : 0);
  const jsonError = $derived.by(() => {
    if (type !== "ReJSON-RL") return null;
    const err = checkJson(jsonText);
    return err ? t("editors.errors.at", { line: err.line, column: err.column }) : null;
  });
  const scoreValid = $derived(score.trim() !== "" && Number.isFinite(Number(score.trim())));
  const streamIdValid = $derived(/^(\*|\d+(-(\d+|\*))?)$/.test(streamId.trim()));

  $effect(() => {
    const input = nameInput;
    if (!input) return;
    // Önek doluyken imleç sonda, seçili değil
    queueMicrotask(() => {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  });

  const units: TtlUnit[] = ["s", "m", "h", "d"];

  function validate(): string | null {
    if (!name) return t("editors.newKey.nameRequired");
    if (ttlMs === null) return t("editors.ttl.invalid");
    if (type === "hash" && !field) return t("editors.hash.fieldRequired");
    if (type === "zset" && !scoreValid) return t("editors.zset.badScore");
    if (type === "stream") {
      if (!streamIdValid) return t("editors.stream.badId");
      if (!rows.some((r) => r.field)) return t("editors.stream.needField");
    }
    if (type === "ReJSON-RL" && jsonError) return `${t("editors.errors.jsonSyntax")} — ${jsonError}`;
    return null;
  }

  async function submit() {
    if (busy || ws.readOnly) return;
    nameError = null;
    error = validate();
    if (error) {
      if (!name) {
        nameError = error;
        error = null;
        nameInput?.focus();
      }
      return;
    }
    const spec: NewKey = {
      key: name,
      type: type as KeyType,
      ttlMs: ttlMs ?? 0,
      field: type === "hash" ? field : "",
      value: type === "string" ? (stringEditor?.getText() ?? stringText) : type === "ReJSON-RL" ? minifyJson(jsonEditor?.getText() ?? jsonText) : value,
      score: type === "zset" ? Number(score.trim()) : 0,
      entries: type === "stream" ? rows.filter((r) => r.field).map((r) => ({ field: r.field, value: r.value })) : [],
      streamId: type === "stream" && streamId.trim() !== "*" ? streamId.trim() : "",
    };
    busy = true;
    try {
      await api.keys.create(ws.connectionId, ws.db, spec);
      ws.addKey(name, { type: spec.type, ttl: spec.ttlMs > 0 ? spec.ttlMs : -1 });
      ws.openKey(name, false);
      onclose();
    } catch (err) {
      if (err instanceof ApiError && err.kind === "exists") {
        nameError = t("editors.newKey.exists");
        nameInput?.focus();
      } else error = describeError(err);
    } finally {
      busy = false;
    }
  }

  function onkeydowncapture(e: KeyboardEvent) {
    // Mod+Enter her yerden gönderir (CodeMirror'ın satır eklemesinden önce yakalanır)
    if (e.key === "Enter" && (isMac ? e.metaKey : e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      void submit();
    }
  }

  function onkeydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (e.key === "Enter" && !e.defaultPrevented && target instanceof HTMLInputElement && target.type !== "checkbox" && !target.closest("[data-rows]")) {
      e.preventDefault();
      void submit();
    }
  }
</script>

<Modal title={t("editors.newKey.title")} subtitle={t("editors.newKey.subtitle", { db: ws.db })} size="md" {onclose} dismissible={!busy}>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <form
    id="new-key"
    class="form"
    onsubmit={(e) => {
      e.preventDefault();
      void submit();
    }}
    {onkeydowncapture}
    {onkeydown}
  >
    {#if ws.readOnly}
      <div class="readonly"><Lock size={14} /> {t("common.readOnlyBlocked")}</div>
    {/if}

    <div class="field">
      <label for="new-key-name">{t("editors.newKey.name")}</label>
      <input
        id="new-key-name"
        bind:this={nameInput}
        class="input mono"
        class:invalid={!!nameError}
        bind:value={name}
        oninput={() => (nameError = null)}
        placeholder={t("editors.newKey.namePlaceholder")}
        spellcheck="false"
        autocomplete="off"
        data-autofocus
      />
      {#if nameError}<span class="error-text">{nameError}</span>{/if}
    </div>

    <div class="field">
      <span class="label">{t("editors.newKey.type")}</span>
      <div class="types"><Segmented size="sm" bind:value={type} options={types} onchange={() => (error = null)} /></div>
    </div>

    <div class="field">
      <label for="new-key-ttl">{t("editors.newKey.ttl")} <span class="muted">({t("common.optional")})</span></label>
      <div class="row">
        <input id="new-key-ttl" class="input sm ttl" class:invalid={ttlMs === null} bind:value={ttlText} placeholder={t("editors.newKey.ttlPlaceholder")} autocomplete="off" spellcheck="false" />
        <select class="select sm unit" bind:value={ttlUnit} aria-label={t("editors.ttl.unit")}>
          {#each units as u (u)}<option value={u}>{t(`editors.ttl.units.${u}`)}</option>{/each}
        </select>
        <span class="hint">{ttlMs === null ? t("editors.ttl.invalid") : ttlMs ? t("editors.newKey.ttlHint") : t("common.ttl.persistent")}</span>
      </div>
    </div>

    <div class="divider"></div>

    {#if type === "string"}
      <div class="field">
        <span class="label">{t("editors.hash.value")}</span>
        <div class="code">
          <CodeEditor
            bind:this={stringEditor}
            baseline=""
            lang={stringLang}
            wrap
            label={t("editors.hash.value")}
            onchange={() => {
              stringText = stringEditor?.getText() ?? "";
              stringLang = looksLikeJsonContainer(stringText) && !checkJson(stringText) ? "json" : "text";
            }}
          />
        </div>
      </div>
    {:else if type === "hash"}
      <div class="field">
        <label for="new-key-field">{t("editors.hash.field")}</label>
        <input id="new-key-field" class="input sm mono" bind:value={field} spellcheck="false" autocomplete="off" />
      </div>
      <div class="field">
        <label for="new-key-value">{t("editors.hash.value")}</label>
        <textarea id="new-key-value" class="textarea mono" rows="4" bind:value spellcheck="false"></textarea>
      </div>
    {:else if type === "list" || type === "set"}
      <div class="field">
        <label for="new-key-value">{type === "list" ? t("editors.newKey.firstItem") : t("editors.set.member")}</label>
        <textarea id="new-key-value" class="textarea mono" rows="4" bind:value spellcheck="false"></textarea>
      </div>
    {:else if type === "zset"}
      <div class="zset">
        <div class="field grow">
          <label for="new-key-value">{t("editors.set.member")}</label>
          <input id="new-key-value" class="input sm mono" bind:value spellcheck="false" autocomplete="off" />
        </div>
        <div class="field score">
          <label for="new-key-score">{t("editors.zset.score")}</label>
          <input id="new-key-score" class="input sm mono" class:invalid={!scoreValid} bind:value={score} inputmode="decimal" autocomplete="off" />
        </div>
      </div>
    {:else if type === "stream"}
      <div class="field">
        <label for="new-key-stream-id">{t("editors.stream.id")}</label>
        <input id="new-key-stream-id" class="input sm mono stream-id" class:invalid={!streamIdValid} bind:value={streamId} spellcheck="false" autocomplete="off" />
        <span class="hint">{t("editors.stream.idHint")}</span>
      </div>
      <div data-rows><FieldRows bind:rows idPrefix="new-key-rows" /></div>
    {:else if type === "ReJSON-RL"}
      <div class="field">
        <span class="label">{t("common.types.json")}</span>
        <div class="code" class:invalid={!!jsonError}>
          <CodeEditor bind:this={jsonEditor} baseline={"{}"} lang="json" wrap label={t("common.types.json")} onchange={() => (jsonText = jsonEditor?.getText() ?? "")} />
        </div>
        {#if jsonError}<span class="error-text">{t("editors.errors.jsonSyntax")} — {jsonError}</span>{/if}
      </div>
    {/if}

    {#if error}<div class="error-text" role="alert">{error}</div>{/if}
  </form>

  {#snippet footer()}
    <span class="hint grow">{t("editors.newKey.submitHint", { keys: isMac ? "⌘↵" : "Ctrl+↵" })}</span>
    <button class="btn" onclick={onclose} disabled={busy}>{t("common.cancel")}</button>
    <button class="btn primary" type="submit" form="new-key" disabled={busy || ws.readOnly || !name}>
      {#if busy}<Spinner size={12} />{/if}
      {t("editors.newKey.create")}
    </button>
  {/snippet}
</Modal>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .readonly {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: var(--radius);
    background: var(--warning-soft);
    color: var(--warning);
    font-size: var(--fs-sm);
  }

  .types {
    overflow-x: auto;
  }

  .ttl {
    width: 160px;
  }

  .unit {
    width: 100px;
  }

  .code {
    height: 170px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    overflow: hidden;
  }

  .code:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .code.invalid {
    border-color: var(--danger);
  }

  .zset {
    display: flex;
    gap: 10px;
  }

  .score {
    width: 160px;
    flex: none;
  }

  .stream-id {
    max-width: 260px;
  }
</style>
