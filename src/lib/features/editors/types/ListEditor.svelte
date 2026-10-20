<script lang="ts">
  // List: dizin | değer, tembel sayfalama (LRANGE). Süzgeç yüklenen satırlarda istemci tarafında çalışır.
  import ArrowDownToLine from "@lucide/svelte/icons/arrow-down-to-line";
  import ArrowUpToLine from "@lucide/svelte/icons/arrow-up-to-line";
  import Copy from "@lucide/svelte/icons/copy";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Plus from "@lucide/svelte/icons/plus";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import { untrack } from "svelte";
  import { api, ApiError } from "$lib/api";
  import type { RBytes } from "$lib/api/types";
  import { fmtNumber, t } from "$lib/i18n/index.svelte";
  import { confirm } from "$lib/state/dialogs.svelte";
  import { openContextMenu, type MenuItem } from "$lib/state/menu.svelte";
  import { settings } from "$lib/state/settings.svelte";
  import { toast, toastError } from "$lib/state/toasts.svelte";
  import EmptyState from "$lib/ui/EmptyState.svelte";
  import Segmented from "$lib/ui/Segmented.svelte";
  import Spinner from "$lib/ui/Spinner.svelte";
  import { tooltip } from "$lib/ui/tooltip.svelte";
  import { copyText } from "$lib/util/clipboard";
  import { compileMatcher } from "$lib/util/match";
  import type { EditorContext } from "../context";
  import { editorLayout, saveViewMemory, viewMemory } from "../host.svelte";
  import AddValuesDialog from "../table/AddValuesDialog.svelte";
  import Bar from "../table/Bar.svelte";
  import FilterBox from "../table/FilterBox.svelte";
  import Highlight from "../table/Highlight.svelte";
  import ItemTable from "../table/ItemTable.svelte";
  import MultiSummary from "../table/MultiSummary.svelte";
  import { PagedLoader } from "../table/paged.svelte";
  import { plain, preview } from "../table/preview";
  import { RowSelection } from "../table/rows.svelte";
  import SplitView from "../table/SplitView.svelte";
  import ValueEditor from "../value/ValueEditor.svelte";

  let { ctx }: { ctx: EditorContext } = $props();

  // Bağlam bileşen ömrü boyunca sabittir (anahtar/db değişince KeyEditor yeniden bağlanır)
  const { cid, db, memoryKey } = untrack(() => ({ cid: ctx.ws.connectionId, db: ctx.ws.db, memoryKey: `${ctx.scope}#view` }));
  const memory = viewMemory(memoryKey, { term: "", caseSensitive: settings.caseSensitive, cursor: -1 });

  let term = $state(memory.term);
  let caseSensitive = $state(memory.caseSensitive);
  let applied = $state({ term: memory.term, caseSensitive: memory.caseSensitive });
  const matcher = $derived(applied.term ? compileMatcher({ mode: "contains", term: applied.term, caseSensitive: applied.caseSensitive }) : null);

  const paged = new PagedLoader<RBytes>((start, count) => api.list.range(cid, db, ctx.key, start, count), onError);

  /** Süzgeç açıkken görünen satırların liste dizinleri */
  const filtered = $derived(matcher ? paged.loadedEntries().filter((e) => matcher.test(plain(e.item))).map((e) => e.index) : null);
  const count = $derived(filtered ? filtered.length : paged.total);
  const indexAt = (row: number) => (filtered ? (filtered[row] ?? -1) : row);

  const selection = new RowSelection(
    (row) => String(indexAt(row)),
    () => count,
  );

  let table = $state<ItemTable>();
  let editor = $state<ValueEditor>();
  let pushing = $state(false);
  let tail = $state(true);

  const currentIndex = $derived(selection.size <= 1 && selection.cursor >= 0 ? indexAt(selection.cursor) : -1);
  const current = $derived(currentIndex >= 0 ? paged.at(currentIndex) : undefined);

  function onError(err: unknown) {
    if (err instanceof ApiError && err.kind === "notFound") ctx.ongone();
    else ctx.ws.handleError(err);
  }

  async function reload() {
    await paged.reset();
    if (!paged.ready) return;
    ctx.onlength(paged.total);
    if (paged.total === 0) ctx.ongone();
  }

  void reload().then(() => {
    if (memory.cursor >= 0 && memory.cursor < count) {
      selection.single(memory.cursor);
      table?.scrollToIndex(memory.cursor);
    }
  });

  $effect(() => () => saveViewMemory(memoryKey, { term, caseSensitive, cursor: selection.cursor }));

  async function beforeMove(): Promise<boolean> {
    if (!editor?.isDirty()) return true;
    const ok = await confirm({ title: t("editors.value.discardTitle"), message: t("editors.value.discardRow"), confirmLabel: t("editors.value.discard"), danger: true });
    if (ok) await editor.revert(false);
    return ok;
  }

  async function onFilter() {
    if (!(await beforeMove())) return;
    selection.reset();
    applied = { term, caseSensitive };
  }

  async function saveItem(index: number, value: RBytes) {
    await api.list.set(cid, db, ctx.key, index, value);
    paged.update(index, value);
  }

  async function push(values: string[]) {
    // LPUSH değerleri ters sırayla başa koyar; satırlar yazıldığı sırada görünsün diye ters gönderilir
    const length = await api.list.push(cid, db, ctx.key, tail ? values : [...values].reverse(), tail);
    selection.reset();
    await paged.reset();
    ctx.onlength(length);
    toast("success", t("editors.list.pushed", { count: values.length }), { timeout: 2000 });
    const target = tail ? Math.max(0, length - 1) : 0;
    if (!filtered) table?.scrollToIndex(target);
  }

  function selectedIndexes(): number[] {
    return [...selection.ids].map(Number).filter((n) => n >= 0);
  }

  async function deleteSelected() {
    const indexes = selectedIndexes().sort((a, b) => a - b);
    if (indexes.length === 0 || ctx.readOnly) return;
    const ok = await confirm({
      title: t("editors.list.deleteTitle", { count: indexes.length }),
      message: t("editors.list.deleteMessage"),
      details: indexes.slice(0, 12).map((i) => `#${i}  ${preview(paged.at(i) ?? "").slice(0, 80)}`),
      confirmLabel: t("common.delete"),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.list.remove(cid, db, ctx.key, indexes);
      await editor?.revert(false);
      selection.reset();
      await paged.reset();
      ctx.onlength(paged.total);
      if (paged.total === 0) {
        toast("info", t("editors.emptiedKey"));
        ctx.ongone();
      }
    } catch (err) {
      toastError(err);
    }
  }

  async function copy(text: string) {
    try {
      await copyText(text);
      toast("success", t("common.copied"), { timeout: 1500 });
    } catch (err) {
      toastError(err);
    }
  }

  function copyJson() {
    const values = selectedIndexes()
      .sort((a, b) => a - b)
      .map((i) => paged.at(i))
      .filter((v): v is RBytes => v !== undefined)
      .map(plain);
    void copy(JSON.stringify(values, null, 2));
  }

  function copySelection() {
    const indexes = selectedIndexes();
    const value = indexes.length === 1 ? paged.at(indexes[0]) : undefined;
    if (value !== undefined) void copy(plain(value));
    else copyJson();
  }

  function onmenu(e: MouseEvent, row: number | null) {
    const index = row === null ? -1 : indexAt(row);
    const value = index >= 0 ? paged.at(index) : undefined;
    const items: MenuItem[] = [];
    if (value !== undefined) {
      items.push(
        { label: t("editors.table.editValue"), icon: Pencil, shortcut: "Enter", disabled: selection.size > 1, run: () => editor?.focus() },
        { kind: "separator" },
        { label: t("editors.table.copyValue"), icon: Copy, run: () => copy(plain(value)) },
        { label: t("editors.table.copyJson"), run: copyJson },
        { kind: "separator" },
        { label: t("editors.table.deleteSelected", { count: selection.size }), icon: Trash2, shortcut: "Delete", danger: true, disabled: ctx.readOnly, run: deleteSelected },
      );
    } else {
      items.push(
        { label: t("editors.list.pushHead"), icon: ArrowUpToLine, disabled: ctx.readOnly, run: () => openPush(false) },
        { label: t("editors.list.pushTail"), icon: ArrowDownToLine, disabled: ctx.readOnly, run: () => openPush(true) },
      );
    }
    openContextMenu(e, items);
  }

  function openPush(atTail: boolean) {
    tail = atTail;
    pushing = true;
  }
</script>

<Bar>
  <FilterBox bind:term bind:caseSensitive placeholder={t("editors.list.filter")} onchange={onFilter} />
  <span class="count tabular">
    {#if filtered}
      {t("editors.list.filteredLoaded", { count: filtered.length, loaded: paged.loaded, total: paged.total })}
    {:else}
      {t("editors.meta.items", { count: paged.total })}
    {/if}
  </span>
  {#if filtered && !paged.allLoaded}
    {#if paged.loadingAll}
      <Spinner size={12} />
      <button class="btn ghost sm" onclick={() => paged.stop()}>{t("editors.table.stop")}</button>
    {:else}
      <button class="btn ghost sm" onclick={() => paged.loadAll()}>{t("common.loadAll")}</button>
    {/if}
  {/if}
  <span class="spacer"></span>
  {#if selection.size > 0 && !ctx.readOnly}
    <button class="btn ghost sm" onclick={deleteSelected} use:tooltip={{ text: t("editors.table.deleteSelected", { count: selection.size }), shortcut: "Delete" }}>
      <Trash2 size={13} />
      {fmtNumber(selection.size)}
    </button>
  {/if}
  {#if !ctx.readOnly}
    <button class="btn sm" onclick={() => openPush(true)} aria-label={t("editors.list.push")}><Plus size={13} /> <span class="label">{t("editors.list.push")}</span></button>
  {/if}
</Bar>

<SplitView bind:size={editorLayout.detail} showDetail={selection.size > 0}>
  <ItemTable
    bind:this={table}
    {count}
    {selection}
    idAt={(row) => String(indexAt(row))}
    columns="72px minmax(0, 1fr)"
    label={t("editors.list.tableLabel")}
    {beforeMove}
    onactivate={() => editor?.focus()}
    ondelete={deleteSelected}
    oncopy={copySelection}
    {onmenu}
    onrange={(start, end) => {
      if (!filtered) paged.ensure(start, end);
    }}
  >
    {#snippet header()}
      <span class="hcell num">{t("editors.list.index")}</span>
      <span class="hcell">{t("editors.hash.value")}</span>
    {/snippet}
    {#snippet cell(row)}
      {@const index = indexAt(row)}
      {@const value = paged.at(index)}
      <span class="cell num tabular">{index}</span>
      {#if value !== undefined}
        <span class="cell mono"><Highlight text={preview(value)} {matcher} /></span>
      {:else}
        <span class="cell placeholder"></span>
      {/if}
    {/snippet}
    {#snippet empty()}
      {#if paged.ready}
        <EmptyState compact title={filtered ? t("editors.table.noMatch") : t("editors.list.empty")} description={filtered && !paged.allLoaded ? t("editors.list.filterLoadedHint") : undefined} />
      {/if}
    {/snippet}
  </ItemTable>

  {#snippet detail()}
    {#if selection.size > 1}
      <MultiSummary count={selection.size} readOnly={ctx.readOnly} ondelete={deleteSelected} oncopy={copyJson} />
    {:else if current !== undefined && currentIndex >= 0}
      {#key currentIndex}
        <ValueEditor bind:this={editor} value={current} readOnly={ctx.readOnly} onsave={(v) => saveItem(currentIndex, v)} draftKey={`${ctx.scope}#i:${currentIndex}`} compact>
          {#snippet header()}
            <div class="detail-head">{t("editors.list.itemAt", { index: currentIndex })}</div>
          {/snippet}
        </ValueEditor>
      {/key}
    {/if}
  {/snippet}
</SplitView>

{#if pushing}
  <AddValuesDialog title={t("editors.list.pushTitle")} onsubmit={push} onclose={() => (pushing = false)}>
    {#snippet options()}
      <Segmented
        size="sm"
        bind:value={tail}
        options={[
          { value: false, label: t("editors.list.head"), icon: ArrowUpToLine },
          { value: true, label: t("editors.list.tail"), icon: ArrowDownToLine },
        ]}
      />
    {/snippet}
  </AddValuesDialog>
{/if}

<style>
  .hcell {
    padding: 0 8px;
  }

  .num {
    text-align: right;
    color: var(--text-3);
  }

  .cell {
    padding: 0 8px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .placeholder {
    height: 8px;
    margin: 0 8px;
    border-radius: 4px;
    background: var(--bg-hover);
  }

  .detail-head {
    padding: 6px 10px;
    border-bottom: 1px solid var(--border-subtle);
    color: var(--text-2);
    font-size: var(--fs-sm);
    font-weight: 500;
  }
</style>
