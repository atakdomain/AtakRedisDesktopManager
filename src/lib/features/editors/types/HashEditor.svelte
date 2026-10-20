<script lang="ts">
  // Hash: alan | değer tablosu (HSCAN + sunucu süzgeci), altta seçili alanın düzenleyicisi.
  import Copy from "@lucide/svelte/icons/copy";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Plus from "@lucide/svelte/icons/plus";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import { tick, untrack } from "svelte";
  import { api, ApiError } from "$lib/api";
  import { bytesId, isBinary, label } from "$lib/api/bytes";
  import type { HashEntry, RBytes } from "$lib/api/types";
  import { fmtNumber, t } from "$lib/i18n/index.svelte";
  import { confirm } from "$lib/state/dialogs.svelte";
  import { openContextMenu, type MenuItem } from "$lib/state/menu.svelte";
  import { settings } from "$lib/state/settings.svelte";
  import { toast, toastError } from "$lib/state/toasts.svelte";
  import EmptyState from "$lib/ui/EmptyState.svelte";
  import Resizer from "$lib/ui/Resizer.svelte";
  import Spinner from "$lib/ui/Spinner.svelte";
  import { tooltip } from "$lib/ui/tooltip.svelte";
  import { copyText } from "$lib/util/clipboard";
  import { compileMatcher } from "$lib/util/match";
  import { valueFilter, type EditorContext } from "../context";
  import { editorLayout, saveViewMemory, viewMemory } from "../host.svelte";
  import { parseName } from "../names";
  import Bar from "../table/Bar.svelte";
  import FilterBox from "../table/FilterBox.svelte";
  import Highlight from "../table/Highlight.svelte";
  import ItemTable from "../table/ItemTable.svelte";
  import ListFooter from "../table/ListFooter.svelte";
  import MultiSummary from "../table/MultiSummary.svelte";
  import { plain, preview } from "../table/preview";
  import { RowSelection } from "../table/rows.svelte";
  import { ScanLoader, SCAN_COUNT } from "../table/scan.svelte";
  import SplitView from "../table/SplitView.svelte";
  import ValueEditor from "../value/ValueEditor.svelte";

  let { ctx }: { ctx: EditorContext } = $props();

  // Bağlam bileşen ömrü boyunca sabittir (anahtar/db değişince KeyEditor yeniden bağlanır)
  const { cid, db, memoryKey } = untrack(() => ({ cid: ctx.ws.connectionId, db: ctx.ws.db, memoryKey: `${ctx.scope}#view` }));
  const memory = viewMemory(memoryKey, { term: "", caseSensitive: settings.caseSensitive, cursorId: null as string | null });

  let term = $state(memory.term);
  let caseSensitive = $state(memory.caseSensitive);
  const matcher = $derived(term ? compileMatcher({ mode: "contains", term, caseSensitive }) : null);

  const loader = new ScanLoader<HashEntry>(
    (e) => bytesId(e.field),
    (cursor) => api.hash.scan(cid, db, ctx.key, cursor, valueFilter(term, caseSensitive), SCAN_COUNT),
    onError,
  );
  const store = loader.store;
  const selection = new RowSelection(
    (i) => store.idAt(i),
    () => store.length,
  );

  let table = $state<ItemTable>();
  let editor = $state<ValueEditor>();
  let fieldInput = $state<HTMLInputElement>();
  let filterBox = $state<FilterBox>();
  let adding = $state(false);
  let newField = $state("");
  let fieldDraft = $state("");

  const current = $derived(selection.size <= 1 && selection.cursor >= 0 ? store.at(selection.cursor) : undefined);
  const currentId = $derived(current ? bytesId(current.field) : null);
  const fieldText = $derived(current ? label(current.field) : "");

  $effect(() => {
    const text = fieldText;
    untrack(() => (fieldDraft = text));
  });

  function onError(err: unknown) {
    if (err instanceof ApiError && err.kind === "notFound") ctx.ongone();
    else ctx.ws.handleError(err);
  }

  async function reload() {
    await loader.reset();
    if (!loader.ready) return;
    if (!term) {
      ctx.onlength(loader.total);
      if (loader.total === 0) ctx.ongone();
    }
    const restore = memory.cursorId;
    memory.cursorId = null;
    const index = restore ? store.indexOf(restore) : -1;
    if (index >= 0) {
      selection.single(index);
      table?.scrollToIndex(index);
    } else selection.reset();
  }

  void reload();

  $effect(() => () => saveViewMemory(memoryKey, { term, caseSensitive, cursorId: selection.cursorId() }));

  async function onFilter() {
    if (!(await beforeMove())) return;
    adding = false;
    await reload();
  }

  /** Detayda kaydedilmemiş değişiklik varsa satır değişmeden önce sor */
  async function beforeMove(): Promise<boolean> {
    if (!editor?.isDirty()) {
      adding = false;
      return true;
    }
    const ok = await confirm({ title: t("editors.value.discardTitle"), message: t("editors.value.discardRow"), confirmLabel: t("editors.value.discard"), danger: true });
    if (ok) {
      await editor.revert(false);
      adding = false;
    }
    return ok;
  }

  function lookup(id: string): HashEntry | undefined {
    const index = store.indexOf(id);
    return index >= 0 ? store.at(index) : undefined;
  }

  async function saveRow(entry: HashEntry, value: RBytes) {
    const renamed = fieldDraft !== label(entry.field);
    const field = renamed ? parseName(fieldDraft, entry.field) : entry.field;
    if (renamed && !fieldDraft) throw new Error(t("editors.hash.fieldRequired"));
    const overwrite = renamed && store.has(bytesId(field));
    if (overwrite) {
      const ok = await confirm({ title: t("editors.hash.overwriteTitle"), message: t("editors.hash.overwriteMessage", { field: label(field) }), confirmLabel: t("editors.hash.overwrite"), danger: true });
      if (!ok) throw new ApiError("cancelled", "");
    }
    await api.hash.set(cid, db, ctx.key, field, value, renamed ? entry.field : null);
    store.replace(bytesId(entry.field), { field, value });
    if (overwrite) {
      loader.total--;
      ctx.onlength(loader.total);
    }
    const index = store.indexOf(bytesId(field));
    if (index >= 0) selection.single(index);
  }

  async function startAdd() {
    if (ctx.readOnly || !(await beforeMove())) return;
    selection.reset();
    newField = "";
    adding = true;
    void tick().then(() => fieldInput?.focus());
  }

  async function saveNew(value: RBytes) {
    if (!newField) {
      fieldInput?.focus();
      throw new Error(t("editors.hash.fieldRequired"));
    }
    const field = newField;
    if (store.has(bytesId(field)) || (!loader.done && (await existsOnServer(field)))) {
      const ok = await confirm({ title: t("editors.hash.overwriteTitle"), message: t("editors.hash.overwriteMessage", { field }), confirmLabel: t("editors.hash.overwrite"), danger: true });
      if (!ok) throw new ApiError("cancelled", "");
      store.remove(new Set([bytesId(field)]));
      loader.total--;
    }
    await api.hash.set(cid, db, ctx.key, field, value, null);
    adding = false;
    newField = "";
    store.prepend({ field, value });
    loader.total++;
    ctx.onlength(loader.total);
    selection.single(0);
    table?.scrollToIndex(0);
  }

  /** Yüklenmemiş sayfalarda aynı ad var mı (birebir, büyük/küçük duyarlı HSCAN) */
  async function existsOnServer(field: string): Promise<boolean> {
    if (loader.total > 200_000) return false;
    let cursor = "";
    do {
      const page = await api.hash.scan(cid, db, ctx.key, cursor, { mode: "exact", term: field, caseSensitive: true, types: [] }, SCAN_COUNT);
      if (page.items.some((e) => bytesId(e.field) === bytesId(field))) return true;
      cursor = page.cursor;
    } while (cursor);
    return false;
  }

  async function deleteSelected() {
    const entries = [...selection.ids].map(lookup).filter((e): e is HashEntry => !!e);
    if (entries.length === 0 || ctx.readOnly) return;
    const ok = await confirm({
      title: t("editors.hash.deleteTitle", { count: entries.length }),
      details: entries.slice(0, 12).map((e) => label(e.field)).concat(entries.length > 12 ? [t("editors.table.andMore", { count: entries.length - 12 })] : []),
      confirmLabel: t("common.delete"),
      danger: true,
    });
    if (!ok) return;
    try {
      const removed = await api.hash.remove(
        cid,
        db,
        ctx.key,
        entries.map((e) => e.field),
      );
      await editor?.revert(false);
      const cursor = selection.cursor;
      store.remove(new Set(entries.map((e) => bytesId(e.field))));
      loader.total = Math.max(0, loader.total - removed);
      ctx.onlength(loader.total);
      if (loader.total === 0 && !term) {
        toast("info", t("editors.emptiedKey"));
        ctx.ongone();
        return;
      }
      if (store.length > 0) selection.single(Math.min(cursor, store.length - 1));
      else selection.reset();
    } catch (err) {
      toastError(err);
    }
  }

  function selectedEntries(): HashEntry[] {
    return [...selection.ids].map(lookup).filter((e): e is HashEntry => !!e);
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
    const out: Record<string, string> = {};
    for (const e of selectedEntries()) out[plain(e.field)] = plain(e.value);
    void copy(JSON.stringify(out, null, 2));
  }

  function copySelection() {
    const entries = selectedEntries();
    if (entries.length === 1) void copy(plain(entries[0].value));
    else copyJson();
  }

  function onmenu(e: MouseEvent, index: number | null) {
    const entry = index === null ? undefined : store.at(index);
    const items: MenuItem[] = [];
    if (entry) {
      items.push(
        { label: t("editors.table.editValue"), icon: Pencil, shortcut: "Enter", run: () => editor?.focus() },
        { label: t("editors.hash.renameField"), disabled: ctx.readOnly || selection.size > 1, run: () => fieldInput?.focus() },
        { kind: "separator" },
        { label: t("editors.hash.copyField"), icon: Copy, run: () => copy(plain(entry.field)) },
        { label: t("editors.table.copyValue"), run: () => copy(plain(entry.value)) },
        { label: t("editors.table.copyJson"), run: copyJson },
        { kind: "separator" },
        { label: t("editors.table.deleteSelected", { count: selection.size }), icon: Trash2, shortcut: "Delete", danger: true, disabled: ctx.readOnly, run: deleteSelected },
      );
    } else {
      items.push({ label: t("editors.hash.add"), icon: Plus, disabled: ctx.readOnly, run: startAdd });
    }
    openContextMenu(e, items);
  }

  export async function focusFilter(): Promise<void> {
    filterBox?.focus();
  }
</script>

<Bar>
  <FilterBox bind:this={filterBox} bind:term bind:caseSensitive placeholder={t("editors.hash.filter")} onchange={onFilter} server />
  <span class="count tabular">
    {#if term}
      {t("editors.table.matched", { count: store.length })}
    {:else}
      {t("editors.table.loadedOf", { loaded: store.length, total: loader.total })}
    {/if}
  </span>
  {#if loader.loading}<Spinner size={12} />{/if}
  <span class="spacer"></span>
  {#if selection.size > 0 && !ctx.readOnly}
    <button class="btn ghost sm danger-text" onclick={deleteSelected} use:tooltip={{ text: t("editors.table.deleteSelected", { count: selection.size }), shortcut: "Delete" }}>
      <Trash2 size={13} />
      {fmtNumber(selection.size)}
    </button>
  {/if}
  {#if !ctx.readOnly}
    <button class="btn sm" onclick={startAdd} aria-label={t("editors.hash.add")}><Plus size={13} /> <span class="label">{t("editors.hash.add")}</span></button>
  {/if}
</Bar>

<SplitView bind:size={editorLayout.detail} showDetail={adding || selection.size > 0}>
  <ItemTable
    bind:this={table}
    count={store.length}
    {selection}
    idAt={(i) => store.idAt(i)}
    columns="minmax(60px, min({editorLayout.field}px, 50%)) minmax(0, 1fr)"
    label={t("editors.hash.tableLabel")}
    {beforeMove}
    onactivate={() => editor?.focus()}
    ondelete={deleteSelected}
    oncopy={copySelection}
    {onmenu}
  >
    {#snippet header()}
      <span class="hcell resizable">
        <span class="grow">{t("editors.hash.field")}</span>
        <Resizer bind:width={editorLayout.field} min={80} max={900} initial={240} />
      </span>
      <span class="hcell">{t("editors.hash.value")}</span>
    {/snippet}
    {#snippet cell(index)}
      {@const entry = store.at(index)}
      {#if entry}
        <span class="cell mono"><Highlight text={preview(entry.field)} {matcher} /></span>
        <span class="cell mono value">{preview(entry.value)}</span>
      {/if}
    {/snippet}
    {#snippet empty()}
      {#if loader.ready && !loader.loading}
        <EmptyState compact title={term ? t("editors.table.noMatch") : t("editors.hash.empty")} description={term && !loader.done ? t("editors.table.scanMore") : undefined} />
      {/if}
    {/snippet}
    {#snippet footer()}
      <ListFooter loaded={store.length} total={loader.total} done={loader.done} loading={loader.loading} onmore={() => loader.more()} onall={() => loader.more(true)} onstop={() => loader.stop()} />
    {/snippet}
  </ItemTable>

  {#snippet detail()}
    {#if adding}
      <ValueEditor bind:this={editor} value="" onsave={saveNew} extraDirty={!!newField} onrevert={() => (adding = false)} compact>
        {#snippet header()}
          <div class="detail-field">
            <label for="hash-new-field">{t("editors.hash.newField")}</label>
            <input id="hash-new-field" bind:this={fieldInput} class="input sm mono" bind:value={newField} placeholder={t("editors.hash.fieldPlaceholder")} spellcheck="false" autocomplete="off" />
          </div>
        {/snippet}
      </ValueEditor>
    {:else if selection.size > 1}
      <MultiSummary count={selection.size} readOnly={ctx.readOnly} ondelete={deleteSelected} oncopy={copyJson} />
    {:else if current && currentId}
      {#key currentId}
        <ValueEditor
          bind:this={editor}
          value={current.value}
          readOnly={ctx.readOnly}
          onsave={(v) => saveRow(current, v)}
          extraDirty={fieldDraft !== fieldText}
          onrevert={() => (fieldDraft = fieldText)}
          draftKey={`${ctx.scope}#f:${currentId}`}
          compact
        >
          {#snippet header()}
            <div class="detail-field">
              <label for="hash-field">{t("editors.hash.field")}</label>
              <input
                id="hash-field"
                bind:this={fieldInput}
                class="input sm mono"
                bind:value={fieldDraft}
                readonly={ctx.readOnly}
                spellcheck="false"
                autocomplete="off"
                use:tooltip={isBinary(current.field) ? t("editors.key.binaryHint") : undefined}
              />
            </div>
          {/snippet}
        </ValueEditor>
      {/key}
    {/if}
  {/snippet}
</SplitView>

<style>
  .hcell {
    display: flex;
    align-items: center;
    height: 100%;
    padding: 0 8px;
    min-width: 0;
    overflow: hidden;
  }

  .resizable {
    padding-right: 0;
    overflow: visible;
  }

  .cell {
    padding: 0 8px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .value {
    color: var(--text-2);
  }

  .detail-field {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px 6px 10px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .detail-field label {
    flex: none;
    font-size: var(--fs-sm);
    color: var(--text-2);
    min-width: 40px;
  }

  .danger-text:hover:not(:disabled) {
    color: var(--danger);
  }
</style>
