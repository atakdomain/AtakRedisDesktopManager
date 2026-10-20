<script lang="ts">
  // Sanal satır tablosu: onay kutusu sütunu, tık/Shift/Ctrl seçimi, klavye gezinmesi, bağlam menüsü.
  // Hücreleri çağıran çizer (`cell`); sütun genişlikleri CSS grid ile (`columns`).
  import type { Snippet } from "svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { isMac } from "$lib/state/commands.svelte";
  import VirtualList from "$lib/ui/VirtualList.svelte";
  import type { RowSelection } from "./rows.svelte";

  interface Props {
    count: number;
    selection: RowSelection;
    idAt: (index: number) => string;
    /** Onay kutusundan sonraki sütunlar için grid-template-columns */
    columns: string;
    header: Snippet;
    cell: Snippet<[number]>;
    label: string;
    /** İmleç başka satıra geçmeden önce (kaydedilmemiş detay için onay); false → iptal */
    beforeMove?: () => Promise<boolean>;
    onactivate?: (index: number) => void;
    ondelete?: () => void;
    oncopy?: () => void;
    onmenu?: (e: MouseEvent, index: number | null) => void;
    onrange?: (start: number, end: number) => void;
    empty?: Snippet;
    footer?: Snippet;
  }

  let { count, selection, idAt, columns, header, cell, label, beforeMove, onactivate, ondelete, oncopy, onmenu, onrange, empty, footer }: Props = $props();

  const ROW = 26;
  let list = $state<VirtualList>();
  let viewRows = $state(20);

  const allSelected = $derived(count > 0 && selection.size >= count);
  const someSelected = $derived(selection.size > 0 && !allSelected);

  async function guard(): Promise<boolean> {
    return beforeMove ? beforeMove() : true;
  }

  async function onRowClick(e: MouseEvent, index: number) {
    // Çoklu seçim imleci de taşır; detay paneli imleç satırını gösterir
    if (!(await guard())) return;
    selection.click(index, e);
    list?.focus();
  }

  async function onCheck(e: MouseEvent, index: number) {
    e.stopPropagation();
    if (!(await guard())) return;
    if (e.shiftKey) selection.click(index, e);
    else selection.toggle(index);
  }

  async function toggleAll() {
    if (allSelected) selection.reset();
    else selection.all();
  }

  async function moveTo(index: number, extend: boolean) {
    if (count === 0) return;
    if (!(await guard())) return;
    selection.move(index, extend);
    list?.scrollToIndex(Math.max(0, Math.min(count - 1, index)));
  }

  function onkeydown(e: KeyboardEvent) {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const cursor = selection.cursor;
    let handled = true;
    switch (e.key) {
      case "ArrowDown":
        void moveTo(cursor < 0 ? 0 : cursor + 1, e.shiftKey);
        break;
      case "ArrowUp":
        void moveTo(cursor < 0 ? 0 : cursor - 1, e.shiftKey);
        break;
      case "PageDown":
        void moveTo(cursor + viewRows, e.shiftKey);
        break;
      case "PageUp":
        void moveTo(cursor - viewRows, e.shiftKey);
        break;
      case "Home":
        void moveTo(0, e.shiftKey);
        break;
      case "End":
        void moveTo(count - 1, e.shiftKey);
        break;
      case " ":
        if (cursor >= 0) selection.toggle(cursor);
        break;
      case "Enter":
        if (cursor >= 0) onactivate?.(cursor);
        break;
      case "Delete":
        if (selection.size > 0 && ondelete) ondelete();
        else handled = false;
        break;
      case "Escape":
        if (selection.size > 1) selection.single(cursor);
        else handled = false;
        break;
      case "ContextMenu":
        if (onmenu) openKeyboardMenu();
        break;
      default:
        if (mod && e.key.toLowerCase() === "a") selection.all();
        else if (mod && e.key.toLowerCase() === "c" && oncopy && selection.size > 0) oncopy();
        else handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function openKeyboardMenu() {
    const row = list?.element()?.querySelector<HTMLElement>(`[data-index="${selection.cursor}"]`);
    const rect = (row ?? list?.element())?.getBoundingClientRect();
    if (!rect) return;
    onmenu?.(new MouseEvent("contextmenu", { clientX: rect.left + 40, clientY: rect.bottom }), selection.cursor >= 0 ? selection.cursor : null);
  }

  async function onRowMenu(e: MouseEvent, index: number) {
    e.preventDefault();
    e.stopPropagation();
    if (!selection.has(idAt(index))) {
      if (!(await guard())) return;
      selection.single(index);
    }
    onmenu?.(e, index);
  }

  function indeterminate(node: HTMLInputElement, on: boolean) {
    node.indeterminate = on;
    return { update: (next: boolean) => (node.indeterminate = next) };
  }

  export function focus(): void {
    list?.focus();
  }

  export function scrollToIndex(index: number): void {
    list?.scrollToIndex(index);
  }
</script>

<div class="table" style:--cols="28px {columns}">
  <div class="header" role="presentation">
    <span class="check-cell">
      <input
        type="checkbox"
        class="checkbox"
        checked={allSelected}
        use:indeterminate={someSelected}
        disabled={count === 0}
        aria-label={t("editors.table.selectAll")}
        onclick={toggleAll}
      />
    </span>
    {@render header()}
  </div>
  <div class="body">
    <VirtualList
      bind:this={list}
      {count}
      rowHeight={ROW}
      overscan={12}
      tabindex={0}
      role="listbox"
      {label}
      {onkeydown}
      onrange={(start, end) => {
        viewRows = Math.max(1, end - start - 1);
        onrange?.(start, end);
      }}
      oncontextmenu={(e) => {
        e.preventDefault();
        onmenu?.(e, null);
      }}
      {empty}
      {footer}
    >
      {#snippet row(index)}
        {@const id = idAt(index)}
        {@const selected = selection.has(id)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
          class="row"
          class:selected
          class:cursor={selection.cursor === index}
          class:odd={index % 2 === 1}
          role="option"
          tabindex="-1"
          aria-selected={selected}
          data-index={index}
          onclick={(e) => onRowClick(e, index)}
          ondblclick={() => onactivate?.(index)}
          oncontextmenu={(e) => onRowMenu(e, index)}
        >
          <span class="check-cell">
            <input type="checkbox" class="checkbox" checked={selected} tabindex="-1" aria-label={t("editors.table.selectRow")} onclick={(e) => onCheck(e, index)} />
          </span>
          {@render cell(index)}
        </div>
      {/snippet}
    </VirtualList>
  </div>
</div>

<style>
  .table {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .header,
  .row {
    display: grid;
    grid-template-columns: var(--cols);
    align-items: center;
  }

  .header {
    flex: none;
    height: 28px;
    padding-right: 10px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-sunken);
    color: var(--text-2);
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  .header > :global(*) {
    min-width: 0;
  }

  .body {
    flex: 1;
    min-height: 0;
  }

  .body :global(.viewport:focus-visible) {
    outline: none;
    box-shadow: inset 0 0 0 1px var(--accent);
    border-radius: 0;
  }

  .row {
    height: 26px;
    font-size: var(--fs-sm);
    cursor: default;
  }

  .row.odd {
    background: color-mix(in srgb, var(--bg-hover) 45%, transparent);
  }

  .row:hover {
    background: var(--bg-hover);
  }

  .row.selected {
    background: var(--bg-selected);
  }

  .row.cursor {
    box-shadow: inset 2px 0 0 var(--accent);
  }

  .row.selected.cursor {
    background: var(--bg-selected-strong);
  }

  .row > :global(*) {
    min-width: 0;
  }

  .check-cell {
    display: grid;
    place-items: center;
    height: 100%;
  }

  .row .checkbox {
    opacity: 0.45;
  }

  .row:hover .checkbox,
  .row.selected .checkbox {
    opacity: 1;
  }
</style>
