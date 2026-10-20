<script lang="ts">
  // Bayt değeri görüntüleyici/düzenleyici: biçim seçimi (otomatik algılama), CodeMirror, seçilen biçimde geri yazma.
  // Kaydetme `onsave`'e kodlanmış değeri verir; üst bileşen kalıcılaştırıp `value`'yu günceller.
  import Braces from "@lucide/svelte/icons/braces";
  import Check from "@lucide/svelte/icons/check";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Copy from "@lucide/svelte/icons/copy";
  import FileWarning from "@lucide/svelte/icons/file-warning";
  import History from "@lucide/svelte/icons/history";
  import Lock from "@lucide/svelte/icons/lock";
  import Save from "@lucide/svelte/icons/save";
  import Undo2 from "@lucide/svelte/icons/undo-2";
  import WrapText from "@lucide/svelte/icons/wrap-text";
  import { tick, untrack, type Snippet } from "svelte";
  import { ApiError } from "$lib/api";
  import { bytesId, fromBytes, label, toBytes } from "$lib/api/bytes";
  import type { RBytes } from "$lib/api/types";
  import { t } from "$lib/i18n/index.svelte";
  import { isMac } from "$lib/state/commands.svelte";
  import { confirm } from "$lib/state/dialogs.svelte";
  import { openMenu, type MenuItem } from "$lib/state/menu.svelte";
  import { settings } from "$lib/state/settings.svelte";
  import { toast, toastError } from "$lib/state/toasts.svelte";
  import Spinner from "$lib/ui/Spinner.svelte";
  import { tooltip } from "$lib/ui/tooltip.svelte";
  import { copyText } from "$lib/util/clipboard";
  import { fmtBytes } from "$lib/util/format";
  import { encodeBase64 } from "../codec/base64";
  import { COMPRESSED, decodeValue, encodeValue, FORMATS, FormatError, innerBytes, type Decoded, type ResolvedFormat, type ValueFormat } from "../codec/formats";
  import { hexdump } from "../codec/hex";
  import { checkJson, formatJson } from "../codec/json";
  import { apiCodec, dropDraft, readDraft, rememberedFormat, rememberFormat, useHost, writeDraft } from "../host.svelte";
  import { describeError } from "../messages";
  import CodeEditor from "./CodeEditor.svelte";

  interface Props {
    value: RBytes;
    /** Bağlantı salt okunur ya da tür değiştirilemez (stream) */
    readOnly?: boolean;
    onsave?: (value: RBytes) => Promise<void>;
    /** Değer dışında kaydedilmemiş değişiklik (alan adı, skor) — Kaydet açık kalır */
    extraDirty?: boolean;
    onrevert?: () => void;
    ondirty?: (dirty: boolean) => void;
    /** Verilirse taslak ve biçim seçimi bu anahtarla hatırlanır */
    draftKey?: string;
    /** Biçim seçimi sabit (ReJSON) */
    lockedFormat?: ResolvedFormat;
    /** Her kayıtta JSON küçültülür, seçenek gizlenir (ReJSON) */
    alwaysMinify?: boolean;
    compact?: boolean;
    autofocus?: boolean;
    /** Büyük değer en baştan düzenlenebilir açılsın ("Yükle ve düzenle") */
    largeEditable?: boolean;
    /** Araç çubuğunun üstünde (alan adı, skor…) */
    header?: Snippet;
    /** Araç çubuğunda Kaydet'in solunda ek düğmeler */
    actions?: Snippet;
  }

  let {
    value,
    readOnly = false,
    onsave,
    extraDirty = false,
    onrevert,
    ondirty,
    draftKey,
    lockedFormat,
    alwaysMinify = false,
    compact = false,
    autofocus = false,
    largeEditable = false,
    header,
    actions,
  }: Props = $props();

  const LARGE = 2 * 1024 * 1024;
  const host = useHost();

  let editor = $state<CodeEditor>();
  const bytes = $derived(toBytes(value));
  const large = $derived(bytes.length > LARGE);

  let format = $state<ValueFormat>("auto");
  let decoded = $state.raw<Decoded | null>(null);
  /** Çözülmüş içeriğin boyutu (kaydettikten sonra düzenleyici yeniden kurulmadan güncellenir) */
  let innerSize = $state(0);
  let initial = $state<string | undefined>(undefined);
  let error = $state.raw<FormatError | null>(null);
  let busy = $state(false);
  let dirty = $state(false);
  let saving = $state(false);
  let justSaved = $state(false);
  let saveError = $state<string | null>(null);
  let minify = $state(false);
  let editLarge = $state(false);
  let restored = $state(false);

  const locked = $derived(readOnly || !onsave);
  const editorReadOnly = $derived(locked || (large && !editLarge) || saving);
  const anyDirty = $derived(dirty || extraDirty);
  const canSave = $derived(!locked && anyDirty && !saving && (decoded !== null || !dirty));

  let token = 0;
  /** Taslak, yüklendiği andaki anahtar ve özgün değerle saklanır (kapanırken prop'lar yeni satırı gösterebilir) */
  let loadedDraftKey: string | undefined;
  let loadedValue: RBytes = "";
  /** Az önce kaydettiğimiz değer geri gelince düzenleyici yeniden kurulmaz (imleç, yazım korunur) */
  let savedId: string | null = null;

  interface LoadOptions {
    draftText?: string;
    draftMinify?: boolean;
    /** Biçim değişirken taşınan kaydedilmemiş içerik */
    carry?: Uint8Array;
  }

  async function load(fmt: ValueFormat, opts: LoadOptions = {}) {
    const my = ++token;
    const slow = setTimeout(() => my === token && (busy = true), 120);
    error = null;
    saveError = null;
    try {
      const d = await decodeValue(bytes, fmt, apiCodec);
      let start = opts.draftText;
      if (opts.carry) {
        try {
          start = (await decodeValue(opts.carry, d.format, apiCodec)).text;
        } catch {
          start = undefined;
          toast("warning", t("editors.value.carryLost"));
        }
      }
      if (my !== token) return;
      decoded = d;
      innerSize = d.innerSize;
      minify = opts.draftMinify ?? (alwaysMinify || d.compact);
      initial = start;
    } catch (err) {
      if (my !== token) return;
      decoded = null;
      initial = undefined;
      error = err instanceof FormatError ? err : new FormatError("encode", String(err));
    } finally {
      clearTimeout(slow);
      if (my === token) busy = false;
    }
  }

  $effect(() => {
    const v = value;
    untrack(() => {
      const id = bytesId(v);
      if (savedId !== null && id === savedId) {
        savedId = null;
        return;
      }
      savedId = null;
      loadedDraftKey = draftKey;
      loadedValue = v;
      const draft = draftKey ? readDraft(draftKey, v) : undefined;
      restored = !!draft;
      format = lockedFormat ?? draft?.format ?? rememberedFormat(draftKey) ?? "auto";
      editLarge = largeEditable || !!draft;
      void load(format, { draftText: draft?.text, draftMinify: draft?.minify });
    });
  });

  $effect(() => {
    const d = anyDirty;
    untrack(() => ondirty?.(d));
  });

  // Ortak kayıt: Mod+S odak dışındayken, sekme kirliliği
  const handle = host?.register({ dirty: () => canSave, save: () => save(), discard: () => revert(false) });
  $effect(() => {
    const d = anyDirty;
    untrack(() => handle?.setDirty(d));
  });
  $effect(() => () => handle?.unregister());

  async function chooseFormat(next: ValueFormat) {
    if (next === format) return;
    let carry: Uint8Array | undefined;
    if (dirty && decoded && editor) {
      try {
        carry = await encodeValue(editor.getText(), decoded, apiCodec, { minify: false });
      } catch {
        const ok = await confirm({ title: t("editors.value.discardTitle"), message: t("editors.value.discardFormat"), confirmLabel: t("editors.value.discard"), danger: true });
        if (!ok) return;
      }
    }
    format = next;
    rememberFormat(draftKey, next);
    await load(next, { carry });
  }

  function formatMenu(e: MouseEvent) {
    const items: MenuItem[] = [{ kind: "header", label: t("editors.format.title") }];
    for (const f of FORMATS) {
      if (f === "gzip") items.push({ kind: "separator" });
      items.push({
        label: f === "auto" && decoded?.detected ? `${t("editors.format.auto")} (${t(`editors.format.${decoded.format}`)})` : t(`editors.format.${f}`),
        checked: format === f,
        run: () => chooseFormat(f),
      });
    }
    openMenu(items, e.currentTarget as HTMLElement, { minWidth: 200 });
  }

  const formatLabel = $derived(
    format === "auto" ? (decoded ? `${t("editors.format.auto")} · ${t(`editors.format.${decoded.format}`)}` : t("editors.format.auto")) : t(`editors.format.${format}`),
  );

  export async function save(): Promise<boolean> {
    if (!alive || !canSave || !onsave) return false;
    saving = true;
    saveError = null;
    try {
      const text = editor?.getText() ?? "";
      const next = dirty && decoded && editor ? fromBytes(await encodeValue(text, decoded, apiCodec, { minify })) : value;
      savedId = bytesId(next);
      await onsave(next);
      if (dirty && decoded && (decoded.format === "base64" || COMPRESSED.includes(decoded.format))) innerSize = innerBytes(text, decoded, minify).length;
      editor?.markClean();
      if (loadedDraftKey) dropDraft(loadedDraftKey);
      restored = false;
      justSaved = true;
      setTimeout(() => (justSaved = false), 1600);
      await tick();
      savedId = null;
      return true;
    } catch (err) {
      savedId = null;
      // Kullanıcı bir onayı geri çevirdi: sessiz
      if (!(err instanceof ApiError && err.kind === "cancelled")) saveError = describeError(err);
      return false;
    } finally {
      saving = false;
    }
  }

  export async function revert(ask = true): Promise<boolean> {
    if (!alive || !anyDirty) return true;
    if (ask) {
      const ok = await confirm({ title: t("editors.value.revertTitle"), message: t("editors.value.revertMessage"), confirmLabel: t("editors.value.revert") });
      if (!ok) return false;
    }
    if (loadedDraftKey) dropDraft(loadedDraftKey);
    restored = false;
    saveError = null;
    initial = undefined;
    editor?.reset();
    onrevert?.();
    return true;
  }

  // bind:this bir an eski (kapanmış) örneği gösterebilir: kapanan örnek temiz sayılır, işlem yapmaz
  let alive = true;
  $effect(() => () => {
    alive = false;
  });

  export function isDirty(): boolean {
    return alive && anyDirty;
  }

  export function focus(): void {
    if (alive) editor?.focus();
  }

  function onteardown(text: string, wasDirty: boolean) {
    if (!loadedDraftKey) return;
    // Kayıt sürerken kapanıyorsa (ör. yeniden adlandırılan alanın satırı değişti) taslak tutulmaz
    if (wasDirty && !saving) writeDraft(loadedDraftKey, { baseId: bytesId(loadedValue), format, text, minify });
    else dropDraft(loadedDraftKey);
  }

  function prettify() {
    if (!editor) return;
    const text = editor.getText();
    const err = checkJson(text);
    if (err) {
      saveError = describeError(new FormatError("jsonSyntax", err.message, { line: err.line, column: err.column }));
      return;
    }
    editor.replaceText(formatJson(text));
  }

  async function copy(kind: "text" | "raw" | "hexdump" | "base64") {
    try {
      const text = kind === "text" ? (editor?.getText() ?? "") : kind === "raw" ? label(value) : kind === "hexdump" ? hexdump(bytes) : encodeBase64(bytes);
      await copyText(text);
      toast("success", t("common.copied"), { timeout: 1500 });
    } catch (err) {
      toastError(err);
    }
  }

  function copyMenu(e: MouseEvent) {
    openMenu(
      [
        { label: t("editors.value.copyShown"), run: () => copy("text") },
        { label: t("editors.value.copyRaw"), run: () => copy("raw") },
        { kind: "separator" },
        { label: t("editors.value.copyHexdump"), run: () => copy("hexdump") },
        { label: t("editors.value.copyBase64"), run: () => copy("base64") },
      ],
      e.currentTarget as HTMLElement,
      { align: "end" },
    );
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.defaultPrevented) return;
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      e.stopPropagation();
      void save();
    }
  }

  const sizeText = $derived.by(() => {
    // Ok yalnızca içeriği ayrıca çözülen biçimlerde (base64, sıkıştırma) anlamlı
    if (!decoded || !(decoded.format === "base64" || COMPRESSED.includes(decoded.format)) || innerSize === bytes.length) return fmtBytes(bytes.length);
    return `${fmtBytes(bytes.length)} → ${fmtBytes(innerSize)}`;
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="value" class:compact onkeydown={onkeydown} onfocusin={() => handle?.focused()}>
  {#if header}<div class="head">{@render header()}</div>{/if}

  <div class="toolbar">
    {#if lockedFormat}
      <span class="fixed-format">{t(`editors.format.${lockedFormat}`)}</span>
    {:else}
      <button class="btn ghost sm format" onclick={formatMenu} use:tooltip={t("editors.format.title")}>
        <span>{formatLabel}</span>
        <ChevronDown size={13} />
      </button>
    {/if}
    <span class="size tabular" use:tooltip={t("editors.value.sizeHint")}>{sizeText}</span>
    {#if busy}<Spinner size={12} />{/if}
    {#if readOnly}
      <span class="chip lock" use:tooltip={t("editors.readOnlyHint")}><Lock size={11} /> {t("common.readOnly")}</span>
    {/if}
    {#if anyDirty}<span class="chip dirty">● {t("editors.value.unsaved")}</span>{/if}
    {#if justSaved}<span class="chip saved"><Check size={11} /> {t("common.saved")}</span>{/if}

    <span class="grow"></span>

    {#if decoded?.lang === "json"}
      {#if !editorReadOnly}
        <button class="btn ghost icon sm" onclick={prettify} use:tooltip={t("editors.value.prettify")} aria-label={t("editors.value.prettify")}><Braces size={14} /></button>
      {/if}
      {#if !locked && !alwaysMinify}
        <label class="check minify" use:tooltip={t("editors.value.minifyHint")}>
          <input type="checkbox" bind:checked={minify} />
          <span>{t("editors.value.minify")}</span>
        </label>
      {/if}
    {/if}
    <button
      class="btn ghost icon sm"
      class:on={settings.wordWrap}
      onclick={() => (settings.wordWrap = !settings.wordWrap)}
      use:tooltip={t("editors.value.wrap")}
      aria-label={t("editors.value.wrap")}
      aria-pressed={settings.wordWrap}><WrapText size={14} /></button
    >
    <button class="btn ghost icon sm" onclick={copyMenu} use:tooltip={t("editors.value.copy")} aria-label={t("editors.value.copy")}><Copy size={14} /></button>
    {@render actions?.()}
    {#if !locked}
      {#if anyDirty}
        <button class="btn ghost sm" onclick={() => revert()} disabled={saving} use:tooltip={{ text: t("editors.value.revert"), shortcut: "Escape" }}>
          <Undo2 size={13} />
          {#if !compact}{t("editors.value.revert")}{/if}
        </button>
      {/if}
      <button class="btn primary sm" onclick={() => save()} disabled={!canSave} use:tooltip={{ text: t("common.save"), shortcut: "Mod+S" }}>
        {#if saving}<Spinner size={12} />{:else}<Save size={13} />{/if}
        {t("common.save")}
      </button>
    {/if}
  </div>

  {#if restored}
    <div class="banner info">
      <History size={14} />
      <span class="grow">{t("editors.value.restored")}</span>
      <button class="btn sm" onclick={() => revert(false)}>{t("editors.value.discard")}</button>
    </div>
  {/if}
  {#if large && !editLarge && !locked && decoded}
    <div class="banner warn">
      <FileWarning size={14} />
      <span class="grow">{t("editors.value.largeReadOnly", { size: fmtBytes(bytes.length) })}</span>
      <button class="btn sm" onclick={() => (editLarge = true)}>{t("editors.value.editAnyway")}</button>
    </div>
  {/if}
  {#if saveError}
    <div class="banner error selectable" role="alert">
      <span class="grow">{saveError}</span>
      <button class="btn ghost sm" onclick={() => (saveError = null)}>{t("common.close")}</button>
    </div>
  {/if}

  <div class="body">
    {#if error}
      <div class="decode-error">
        <FileWarning size={22} strokeWidth={1.6} />
        <div class="title">{t("editors.value.cannotShow", { format: t(`editors.format.${format}`) })}</div>
        <p class="selectable">{describeError(error)}</p>
        <div class="row">
          <button class="btn sm" onclick={() => chooseFormat("text")}>{t("editors.value.showAsText")}</button>
          <button class="btn sm" onclick={() => chooseFormat("hex")}>{t("editors.value.showAsHex")}</button>
          {#if format !== "auto"}<button class="btn sm" onclick={() => chooseFormat("auto")}>{t("editors.format.auto")}</button>{/if}
        </div>
      </div>
    {:else if decoded}
      <CodeEditor
        bind:this={editor}
        baseline={decoded.text}
        {initial}
        lang={decoded.lang}
        readOnly={editorReadOnly}
        wrap={settings.wordWrap && decoded.lang !== "hex"}
        {autofocus}
        label={t("editors.value.editorLabel")}
        ondirty={(d) => {
          dirty = d;
          if (d) saveError = null;
        }}
        onsave={() => void save()}
        onescape={() => {
          if (!anyDirty || locked) return false;
          void revert();
          return true;
        }}
        {onteardown}
      />
    {:else}
      <div class="loading"><Spinner size={16} /></div>
    {/if}
  </div>
</div>

<style>
  .value {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    min-width: 0;
  }

  .head {
    flex: none;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: none;
    height: 34px;
    min-width: 0;
    overflow: hidden;
    padding: 0 8px 0 6px;
    border-bottom: 1px solid var(--border-subtle);
    background: var(--bg);
    font-size: var(--fs-sm);
  }

  .compact .toolbar {
    height: 30px;
  }

  .format {
    flex: 0 1 auto;
    min-width: 0;
    font-weight: 500;
    color: var(--text);
  }

  .format span {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .toolbar > :global(.btn:not(.format)) {
    flex: none;
  }

  .fixed-format {
    padding: 0 8px;
    font-weight: 500;
  }

  .size {
    color: var(--text-3);
    margin: 0 4px;
    white-space: nowrap;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 18px;
    padding: 0 6px;
    border-radius: 999px;
    font-size: var(--fs-xs);
    white-space: nowrap;
  }

  .lock {
    background: var(--warning-soft);
    color: var(--warning);
  }

  .dirty {
    background: var(--accent-soft);
    color: var(--accent-text);
  }

  .saved {
    background: var(--success-soft);
    color: var(--success);
  }

  .minify {
    gap: 5px;
    margin: 0 4px;
    font-size: var(--fs-sm);
    color: var(--text-2);
    white-space: nowrap;
  }

  .btn.on {
    color: var(--accent-text);
    background: var(--accent-soft);
  }

  .banner {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    padding: 5px 10px;
    border-bottom: 1px solid var(--border-subtle);
    font-size: var(--fs-sm);
  }

  .banner.info {
    background: var(--accent-soft);
    color: var(--text);
  }

  .banner.warn {
    background: var(--warning-soft);
    color: var(--text);
  }

  .banner.warn :global(svg) {
    color: var(--warning);
  }

  .banner.error {
    background: var(--danger-soft);
    color: var(--danger);
  }

  .body {
    position: relative;
    flex: 1;
    min-height: 0;
  }

  .loading {
    display: grid;
    place-items: center;
    height: 100%;
    color: var(--text-3);
  }

  .decode-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 100%;
    padding: 24px;
    text-align: center;
    color: var(--text-3);
  }

  .decode-error .title {
    color: var(--text);
    font-weight: 600;
  }

  .decode-error p {
    max-width: 460px;
    font-size: var(--fs-sm);
    word-break: break-word;
  }
</style>
