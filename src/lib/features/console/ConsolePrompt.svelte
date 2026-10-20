<script lang="ts">
  // Komut satırı: geçmiş (↑/↓, Ctrl+R), komut adı tamamlama (Tab/→), redis-cli tarzı soluk argüman ipucu, çok satırlı yapıştırma.
  import { t } from "$lib/i18n/index.svelte";
  import Kbd from "$lib/ui/Kbd.svelte";
  import Spinner from "$lib/ui/Spinner.svelte";
  import { acceptCommand, argHint, commandQuery, ghostText, rankCommands } from "./complete";
  import type { CommandSpec } from "./commands";
  import { searchHistory, stepHistory } from "./history";
  import { splitLines } from "./parse";
  import type { ConsoleSession } from "./session.svelte";

  interface Props {
    session: ConsoleSession;
    onsubmit: (line: string) => void;
    onbatch: (lines: string[]) => void;
    oncancel: () => void;
  }

  let { session, onsubmit, onbatch, oncancel }: Props = $props();

  let input = $state<HTMLInputElement>();
  let mirror = $state<HTMLDivElement>();
  let caretAtEnd = $state(true);
  let dismissed = $state(false);
  let navigated = $state(false);
  let selected = $state(0);
  let searching = $state(false);
  let navIndex = -1;
  let navPrefix = "";

  const value = $derived(session.draft);
  const query = $derived(searching ? null : commandQuery(value));
  const suggestions = $derived(query !== null ? rankCommands(query, 8) : []);
  const historyHits = $derived(searching ? searchHistory(session.history, value, 8) : []);
  const itemCount = $derived(searching ? historyHits.length : suggestions.length);
  /** Ad tam yazıldıysa öneri listesi gizlenir (soluk ipucu argümanları gösterir) */
  const exact = $derived(query !== null && suggestions[0]?.name === query.trim().toUpperCase().replace(/\s+/g, " "));
  const popupOpen = $derived(!dismissed && (searching || (itemCount > 0 && !exact)));
  const current = $derived<CommandSpec | undefined>(suggestions[navigated ? selected : 0]);
  const ghost = $derived(!searching && caretAtEnd ? ghostText(value, current) : "");
  const completion = $derived(query !== null && current !== undefined && ghost !== "" && current.name.startsWith(query.toUpperCase().replace(/\s+/g, " ").trimStart()));
  const hint = $derived<CommandSpec | null>(searching ? null : popupOpen && current ? current : (argHint(value)?.spec ?? null));
  const prompt = $derived(`${session.node ? `${session.node} ` : ""}db${session.db}>`);

  export function focus(): void {
    input?.focus();
    if (input) input.selectionStart = input.selectionEnd = input.value.length;
    syncCaret();
  }

  function syncCaret() {
    if (!input) return;
    caretAtEnd = input.selectionStart === input.selectionEnd && input.selectionEnd === input.value.length;
    requestAnimationFrame(() => {
      if (mirror && input) mirror.scrollLeft = input.scrollLeft;
    });
  }

  function setValue(next: string, fromHistory = false) {
    session.draft = next;
    dismissed = fromHistory;
    navigated = false;
    selected = 0;
    requestAnimationFrame(() => {
      if (!input) return;
      input.selectionStart = input.selectionEnd = input.value.length;
      input.scrollLeft = input.scrollWidth;
      syncCaret();
    });
  }

  function accept(spec: CommandSpec | undefined) {
    if (!spec) return;
    setValue(acceptCommand(value, spec));
  }

  function moveSelection(delta: number) {
    if (!itemCount) return;
    navigated = true;
    selected = (selected + delta + itemCount) % itemCount;
  }

  function history(dir: 1 | -1) {
    if (navIndex === -1) navPrefix = value;
    const step = stepHistory(session.history, navPrefix, navIndex, dir);
    if (!step) return;
    navIndex = step.index;
    setValue(step.value, true);
  }

  function submit() {
    if (!value.trim()) return;
    const line = value;
    navIndex = -1;
    setValue("");
    onsubmit(line);
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.isComposing) return;
    const ctrlOnly = e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
    const key = e.key;

    if (ctrlOnly && (key === "r" || key === "R")) {
      searching = !searching;
      dismissed = false;
      navigated = false;
      selected = 0;
    } else if (ctrlOnly && (key === "c" || key === "C")) {
      if (input && input.selectionStart !== input.selectionEnd) return;
      if (session.busy) oncancel();
      else setValue("");
    } else if (key === "Enter") {
      if (searching) {
        const pick = historyHits[selected];
        searching = false;
        if (pick !== undefined) setValue(pick, true);
      } else if (popupOpen && navigated) accept(current);
      else submit();
    } else if (key === "Tab" && !e.shiftKey && !e.ctrlKey && !e.altKey) {
      if (!value) return;
      if (searching) {
        const pick = historyHits[selected];
        searching = false;
        if (pick !== undefined) setValue(pick, true);
      } else if (completion || (popupOpen && current)) accept(current);
    } else if (key === "ArrowRight" && caretAtEnd && completion && !e.shiftKey) {
      accept(current);
    } else if (key === "ArrowDown") {
      if (popupOpen && (navigated || searching)) moveSelection(1);
      else if (popupOpen) navigated = true;
      else if (navIndex >= 0) history(-1);
      else return;
    } else if (key === "ArrowUp") {
      if (popupOpen && (navigated || searching)) moveSelection(-1);
      else history(1);
    } else if (key === "Escape") {
      if (searching) searching = false;
      else if (popupOpen) dismissed = true;
      else if (session.busy) oncancel();
      else if (value) setValue("");
      else return;
    } else return;
    e.preventDefault();
    e.stopPropagation();
  }

  function oninput() {
    navIndex = -1;
    dismissed = false;
    navigated = false;
    selected = 0;
    syncCaret();
  }

  function onpaste(e: ClipboardEvent) {
    const text = e.clipboardData?.getData("text/plain") ?? "";
    if (!/[\r\n]/.test(text) || !input) return;
    e.preventDefault();
    const start = input.selectionStart ?? value.length;
    const end = input.selectionEnd ?? value.length;
    const lines = splitLines(value.slice(0, start) + text + value.slice(end));
    if (lines.length <= 1) {
      setValue(lines[0] ?? "");
      return;
    }
    setValue("");
    onbatch(lines);
  }

  function highlight(name: string): [string, string, string] {
    const q = (query ?? "").toUpperCase().replace(/\s+/g, " ").trimStart();
    if (q && name.startsWith(q)) return ["", name.slice(0, q.length), name.slice(q.length)];
    return [name, "", ""];
  }
</script>

<div class="prompt-bar">
  {#if popupOpen}
    <div class="popup" role="listbox" aria-label={searching ? t("console.historySearch") : t("console.suggestions")}>
      {#if searching}
        <div class="popup-head">{t("console.historySearch")}{#if !historyHits.length}<span class="muted"> — {t("common.noResults")}</span>{/if}</div>
        {#each historyHits as item, i (item)}
          <button
            class="item mono"
            class:active={i === selected}
            role="option"
            aria-selected={i === selected}
            onpointerdown={(e) => e.preventDefault()}
            onclick={() => {
              searching = false;
              setValue(item, true);
            }}><span class="truncate">{item}</span></button
          >
        {/each}
      {:else}
        {#each suggestions as spec, i (spec.name)}
          {@const [pre, match, rest] = highlight(spec.name)}
          <button
            class="item"
            class:active={i === (navigated ? selected : 0)}
            class:focused={navigated && i === selected}
            role="option"
            aria-selected={i === (navigated ? selected : 0)}
            onpointerdown={(e) => e.preventDefault()}
            onclick={() => accept(spec)}
          >
            <span class="name mono">{pre}<b>{match}</b>{rest}</span>
            <span class="args mono truncate">{spec.args}</span>
            <span class="group" lang="en">{spec.group}</span>
          </button>
        {/each}
      {/if}
    </div>
  {/if}

  <div class="line">
    <span class="ps">{prompt}</span>
    <div class="field">
      <div class="mirror" bind:this={mirror} aria-hidden="true"><span class="typed">{value}</span><span class="ghost">{ghost}</span></div>
      <input
        bind:this={input}
        bind:value={session.draft}
        class="input-raw"
        spellcheck="false"
        autocomplete="off"
        autocapitalize="off"
        aria-label={t("console.inputLabel")}
        placeholder={session.blocks.length === 0 ? t("console.placeholder") : ""}
        {onkeydown}
        {oninput}
        {onpaste}
        onkeyup={syncCaret}
        onclick={syncCaret}
        onselect={syncCaret}
        onscroll={syncCaret}
      />
    </div>
    {#if session.busy}
      <span class="busy"><Spinner size={12} /><Kbd shortcut="Escape" subtle /></span>
    {/if}
  </div>

  <div class="hintbar">
    {#if searching}
      <span>{t("console.hints.search")}</span>
    {:else if hint}
      <span class="sig mono truncate"><b>{hint.name}</b> {hint.args}</span>
      <span class="sum truncate">{hint.summary}</span>
      {#if hint.stream}<span class="badge info">{t("console.badges.stream")}</span>{/if}
      {#if hint.dangerous}<span class="badge danger">{t("console.badges.dangerous")}</span>{:else if hint.write}<span class="badge">{t("console.badges.write")}</span>{/if}
      {#if hint.blocking}<span class="badge warn">{t("console.badges.blocking")}</span>{/if}
    {:else}
      <span class="keys">
        <span><Kbd shortcut="Tab" subtle />{t("console.hints.complete")}</span>
        <span><Kbd shortcut="ArrowUp" subtle /><Kbd shortcut="ArrowDown" subtle />{t("console.hints.history")}</span>
        <span><Kbd shortcut="Ctrl+R" subtle />{t("console.hints.searchHistory")}</span>
        <span><Kbd shortcut="Mod+L" subtle />{t("console.hints.clear")}</span>
        <span class="mono">help</span>
      </span>
    {/if}
  </div>
</div>

<style>
  .prompt-bar {
    position: relative;
    flex: none;
    border-top: 1px solid var(--border-subtle);
    background: var(--bg);
  }

  .line {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 14px;
    font-family: var(--font-mono);
    font-size: var(--fs-mono);
  }

  .ps {
    flex: none;
    color: var(--accent-text);
    font-weight: 600;
  }

  .field {
    position: relative;
    flex: 1;
    min-width: 0;
    height: 100%;
  }

  .mirror,
  .input-raw {
    position: absolute;
    inset: 0;
    padding: 0;
    margin: 0;
    border: 0;
    font: inherit;
    letter-spacing: 0;
    line-height: 34px;
    white-space: pre;
  }

  .mirror {
    overflow: hidden;
    pointer-events: none;
    color: transparent;
  }

  .ghost {
    color: var(--text-3);
    opacity: 0.75;
  }

  .input-raw {
    width: 100%;
    background: transparent;
    color: var(--text);
    caret-color: var(--accent);
    outline: none;
  }

  .input-raw::placeholder {
    color: var(--text-3);
  }

  .busy {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text-3);
  }

  .hintbar {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 24px;
    padding: 0 14px 2px;
    color: var(--text-3);
    font-size: var(--fs-xs);
    overflow: hidden;
    white-space: nowrap;
  }

  .sig {
    flex: 0 1 auto;
    max-width: 60%;
    color: var(--text-2);
    font-size: var(--fs-xs);
  }

  .sig b {
    color: var(--text);
    font-weight: 600;
  }

  .sum {
    flex: 1;
    min-width: 0;
  }

  .keys {
    display: flex;
    gap: 14px;
  }

  .keys > span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .badge {
    flex: none;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--bg-active);
    color: var(--text-2);
    font-size: var(--fs-2xs);
    font-weight: 600;
    line-height: 16px;
  }

  .badge.danger {
    background: var(--danger-soft);
    color: var(--danger);
  }

  .badge.warn {
    background: var(--warning-soft);
    color: var(--warning);
  }

  .badge.info {
    background: var(--accent-soft);
    color: var(--accent-text);
  }

  .popup {
    position: absolute;
    left: 10px;
    bottom: calc(100% + 4px);
    z-index: 5;
    width: min(640px, calc(100% - 20px));
    max-height: 260px;
    overflow-y: auto;
    padding: 4px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
  }

  .popup-head {
    padding: 4px 8px 5px;
    color: var(--text-3);
    font-size: var(--fs-xs);
    font-weight: 600;
  }

  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 26px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--radius);
    background: none;
    color: var(--text);
    text-align: left;
    cursor: pointer;
  }

  .item:hover {
    background: var(--bg-hover);
  }

  .item.active {
    background: var(--bg-selected);
  }

  .item.focused {
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  .item .name {
    flex: none;
    color: var(--text-2);
  }

  .item .name b {
    color: var(--text);
    font-weight: 700;
  }

  .item .args {
    flex: 1;
    min-width: 0;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }

  .item .group {
    flex: none;
    color: var(--text-3);
    font-size: var(--fs-2xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
</style>
