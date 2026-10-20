<script lang="ts">
  // Arama girişi: solda mod seçici, sağda VS Code tarzı aç/kapa düğmeleri (Aa, .*, tür süzgeci).
  // Yazarken gecikmeli (debounce) uygular; Enter hemen, Esc temizler. Geçersiz regex'te istek gitmez.
  import CaseSensitive from "@lucide/svelte/icons/case-sensitive";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Funnel from "@lucide/svelte/icons/funnel";
  import Regex from "@lucide/svelte/icons/regex";
  import Search from "@lucide/svelte/icons/search";
  import X from "@lucide/svelte/icons/x";
  import type { KeyFilter, SearchMode } from "$lib/api/types";
  import { regexError } from "$lib/features/bulk/model/patterns";
  import { t } from "$lib/i18n/index.svelte";
  import { openMenu, type MenuItem } from "$lib/state/menu.svelte";
  import { settings } from "$lib/state/settings.svelte";
  import { tooltip } from "$lib/ui/tooltip.svelte";
  import TypeFilter from "./TypeFilter.svelte";

  interface Props {
    filter: KeyFilter;
    /**
     * Yeni süzgeç (bileşen süzgeci kendisi değiştirmez). `search`: sonuç değişir, yeniden aranmalı —
     * boş metinde mod/Aa değişimi sonucu etkilemez. Geçersiz regex'te hiç çağrılmaz.
     */
    onchange: (next: KeyFilter, search: boolean) => void;
    /** Aa ve mod değişince ayarlara da yazılır (yeni aramalarda hatırlanır) */
    sticky?: boolean;
    debounce?: number;
    size?: "md" | "sm";
    /** Esc boş girişte, ↓ her zaman: odağı listeye vermek için */
    onnavigate?: (where: "down" | "escape") => void;
  }

  let { filter, onchange, sticky = false, debounce = 200, size = "md", onnavigate }: Props = $props();

  const MODES: SearchMode[] = ["contains", "prefix", "exact", "glob", "regex"];

  function copy(f: KeyFilter): KeyFilter {
    return { mode: f.mode, term: f.term, caseSensitive: f.caseSensitive, types: [...f.types] };
  }

  let input = $state<HTMLInputElement>();
  let modeButton = $state<HTMLButtonElement>();
  let typesButton = $state<HTMLButtonElement>();
  let typesOpen = $state(false);
  /** Görünen (henüz uygulanmamış olabilir) durum; süzgeç dışarıdan değişince eşitlenir */
  // svelte-ignore state_referenced_locally
  let draft = $state<KeyFilter>(copy(filter));
  // svelte-ignore state_referenced_locally
  let lastPlain: SearchMode = filter.mode === "regex" ? "contains" : filter.mode;
  let timer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    draft = copy(filter);
  });

  $effect(() => () => clearTimeout(timer));

  const error = $derived(draft.mode === "regex" ? regexError(draft.term) : null);

  function emit(search: boolean): void {
    clearTimeout(timer);
    if (draft.mode === "regex" && regexError(draft.term)) return;
    onchange(copy(draft), search);
  }

  /** Metni uygular. `force`: aynı metinde de yeniden ara (Enter) */
  function apply(force = false): void {
    clearTimeout(timer);
    if (!force && draft.term === filter.term) return;
    emit(true);
  }

  function oninput(): void {
    clearTimeout(timer);
    timer = setTimeout(() => apply(), debounce);
  }

  function onkeydown(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      e.preventDefault();
      apply(true);
    } else if (e.key === "Escape") {
      if (draft.term) {
        e.preventDefault();
        e.stopPropagation();
        draft.term = "";
        apply();
      } else if (onnavigate) {
        e.preventDefault();
        onnavigate("escape");
      }
    } else if (e.key === "ArrowDown" && onnavigate) {
      e.preventDefault();
      apply();
      onnavigate("down");
    }
  }

  /** Mod/Aa/tür değişikliği: metin boşsa sonuç değişmez, gereksiz tarama yapılmaz */
  function changed(affectsEmpty: boolean): void {
    emit(affectsEmpty || draft.term !== "" || filter.term !== "");
  }

  export function setMode(mode: SearchMode): void {
    if (mode === draft.mode) return;
    if (mode !== "regex") lastPlain = mode;
    draft.mode = mode;
    if (sticky) settings.searchMode = mode;
    changed(false);
  }

  export function toggleCase(): void {
    draft.caseSensitive = !draft.caseSensitive;
    if (sticky) settings.caseSensitive = draft.caseSensitive;
    changed(false);
  }

  export function toggleRegex(): void {
    setMode(draft.mode === "regex" ? lastPlain : "regex");
  }

  export function setTypes(types: string[]): void {
    draft.types = types;
    changed(true);
  }

  export function focus(select = true): void {
    input?.focus();
    if (select) input?.select();
  }

  function modeMenu(): void {
    if (!modeButton) return;
    const items: MenuItem[] = [
      { kind: "header", label: t("browser.search.mode") },
      ...MODES.map((mode) => ({
        label: t(`browser.search.modes.${mode}`),
        hint: t(`browser.search.modeHints.${mode}`),
        checked: draft.mode === mode,
        shortcut: mode === "regex" ? "Alt+R" : undefined,
        run: () => {
          setMode(mode);
          input?.focus();
        },
      })),
    ];
    openMenu(items, modeButton, { minWidth: 330 });
  }
</script>

<div class="wrap">
  <div class="box {size}" class:invalid={!!error} class:active={filter.term !== "" || filter.types.length > 0}>
    <button
      class="mode"
      class:custom={draft.mode !== "contains"}
      bind:this={modeButton}
      onclick={modeMenu}
      aria-label={t("browser.search.mode")}
      aria-haspopup="menu"
      use:tooltip={t(`browser.search.modeHints.${draft.mode}`)}
    >
      {#if draft.mode === "contains"}<Search size={13} />{:else}<span>{t(`browser.search.modes.${draft.mode}`)}</span>{/if}
      <ChevronDown size={11} />
    </button>
    <input
      bind:this={input}
      bind:value={draft.term}
      class="field"
      class:mono={draft.mode === "regex" || draft.mode === "glob"}
      type="text"
      spellcheck="false"
      autocomplete="off"
      aria-label={t("browser.search.label")}
      aria-invalid={!!error}
      placeholder={t(`browser.search.placeholder.${draft.mode}`)}
      {oninput}
      {onkeydown}
    />
    {#if draft.term}
      <button
        class="toggle ghost"
        aria-label={t("browser.search.clear")}
        use:tooltip={{ text: t("browser.search.clear"), shortcut: "Escape" }}
        onclick={() => {
          draft.term = "";
          apply();
          input?.focus();
        }}><X size={13} /></button
      >
    {/if}
    <button
      class="toggle"
      class:on={draft.caseSensitive}
      aria-pressed={draft.caseSensitive}
      aria-label={t("browser.search.chipCase")}
      use:tooltip={{ text: draft.caseSensitive ? t("browser.search.caseOn") : t("browser.search.caseOff"), shortcut: "Alt+C" }}
      onclick={toggleCase}><CaseSensitive size={15} /></button
    >
    <button
      class="toggle"
      class:on={draft.mode === "regex"}
      aria-pressed={draft.mode === "regex"}
      aria-label={t("browser.search.regex")}
      use:tooltip={{ text: t("browser.search.regex"), shortcut: "Alt+R" }}
      onclick={toggleRegex}><Regex size={14} /></button
    >
    <button
      class="toggle"
      class:on={draft.types.length > 0}
      bind:this={typesButton}
      aria-pressed={draft.types.length > 0}
      aria-label={t("browser.search.types")}
      aria-haspopup="dialog"
      use:tooltip={draft.types.length ? `${t("browser.search.types")}: ${draft.types.join(", ")}` : t("browser.search.types")}
      onclick={() => (typesOpen = !typesOpen)}
    >
      <Funnel size={13} />
      {#if draft.types.length}<span class="count">{draft.types.length}</span>{/if}
    </button>
  </div>
  {#if error}<div class="error-text" role="alert">{t("browser.search.invalidRegex", { message: error })}</div>{/if}
</div>

{#if typesOpen && typesButton}
  <TypeFilter anchor={typesButton} types={draft.types} onchange={setTypes} onclose={() => (typesOpen = false)} />
{/if}

<style>
  .wrap {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .box {
    display: flex;
    align-items: center;
    gap: 1px;
    height: var(--h-control);
    padding: 0 3px 0 2px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--bg-input);
    transition:
      border-color var(--dur) var(--ease),
      box-shadow var(--dur) var(--ease);
  }

  .box.sm {
    height: var(--h-control-sm);
  }

  .box:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .box.invalid {
    border-color: var(--danger);
    box-shadow: 0 0 0 3px var(--danger-soft);
  }

  .mode {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    flex: none;
    height: calc(100% - 6px);
    padding: 0 4px 0 5px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-3);
    font-size: var(--fs-xs);
    font-weight: 600;
    cursor: pointer;
  }

  .mode:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .mode.custom {
    color: var(--accent-text);
    background: var(--accent-soft);
  }

  .field {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0 4px;
    border: 0;
    background: none;
    color: var(--text);
    font-size: var(--fs);
    outline: none;
  }

  .field::placeholder {
    color: var(--text-3);
  }

  .field.mono {
    font-family: var(--font-mono);
    font-size: var(--fs-mono);
  }

  .toggle {
    position: relative;
    display: grid;
    place-items: center;
    flex: none;
    width: 22px;
    height: 20px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-3);
    cursor: pointer;
    transition:
      background var(--dur) var(--ease),
      color var(--dur) var(--ease);
  }

  .sm .toggle {
    height: 18px;
  }

  .toggle:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .toggle.on {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }

  .toggle.on:hover {
    background: var(--accent-hover);
  }

  .count {
    position: absolute;
    top: -5px;
    right: -5px;
    min-width: 13px;
    height: 13px;
    padding: 0 3px;
    border-radius: 999px;
    background: var(--text);
    color: var(--bg);
    font-size: 9px;
    font-weight: 700;
    line-height: 13px;
  }
</style>
