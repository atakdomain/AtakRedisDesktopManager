<script lang="ts">
  // Set: üye tablosu (SSCAN + sunucu süzgeci); üye düzenleme = SREM + SADD (atomik).
  import Copy from "@lucide/svelte/icons/copy";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Plus from "@lucide/svelte/icons/plus";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import { untrack } from "svelte";
  import { api, ApiError } from "$lib/api";
  import { bytesId, label } from "$lib/api/bytes";
  import type { RBytes } from "$lib/api/types";
  import { fmtNumber, t } from "$lib/i18n/index.svelte";
  import { confirm } from "$lib/state/dialogs.svelte";
  import { openContextMenu, type MenuItem } from "$lib/state/menu.svelte";
  import { settings } from "$lib/state/settings.svelte";
  import { toast, toastError } from "$lib/state/toasts.svelte";
  import EmptyState from "$lib/ui/EmptyState.svelte";
  import Spinner from "$lib/ui/Spinner.svelte";
  import { tooltip } from "$lib/ui/tooltip.svelte";
  import { copyText } from "$lib/util/clipboard";
  import { compileMatcher } from "$lib/util/match";
  import { valueFilter, type EditorContext } from "../context";
  import { editorLayout, saveViewMemory, viewMemory } from "../host.svelte";
  import AddValuesDialog from "../table/AddValuesDialog.svelte";
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

  const loader = new ScanLoader<RBytes>(bytesId, (cursor) => api.set.scan(cid, db, ctx.key, cursor, valueFilter(term, caseSensitive), SCAN_COUNT), onError);
  const store = loader.store;
  const selection = new RowSelection(
    (i) => store.idAt(i),
    () => store.length,
  );

  let table = $state<ItemTable>();
  let editor = $state<ValueEditor>();
  let adding = $state(false);

  const current = $derived(selection.size <= 1 && selection.cursor >= 0 ? store.at(selection.cursor) : undefined);
  const currentId = $derived(current !== undefined ? bytesId(current) : null);

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

  async function beforeMove(): Promise<boolean> {
    if (!editor?.isDirty()) return true;
    const ok = await confirm({ title: t("editors.value.discardTitle"), message: t("editors.value.discardRow"), confirmLabel: t("editors.value.discard"), danger: true });
    if (ok) await editor.revert(false);
    return ok;
  }

  async function onFilter() {
    if (!(await beforeMove())) return;
    await reload();
  }

  async function saveMember(old: RBytes, next: RBytes) {
    const merge = bytesId(next) !== bytesId(old) && store.has(bytesId(next));
    if (merge) {
      const ok = await confirm({ title: t("editors.set.existsTitle"), message: t("editors.set.existsMessage"), confirmLabel: t("editors.set.merge") });
      if (!ok) throw new ApiError("cancelled", "");
    }
    await api.set.replace(cid, db, ctx.key, old, next);
    if (merge) {
      store.remove(new Set([bytesId(old)]));
      loader.total--;
      ctx.onlength(loader.total);
    } else store.replace(bytesId(old), next);
    const index = store.indexOf(bytesId(next));
    if (index >= 0) selection.single(index);
  }

  async function addMembers(values: string[]) {
    const members = [...new Set(values)];
    const added = await api.set.add(cid, db, ctx.key, members);
    loader.total += added;
    ctx.onlength(loader.total);
    if (!term) store.append(members);
    toast("success", t("editors.set.added", { added, skipped: members.length - added }), { timeout: 2500 });
  }

  function lookup(id: string): RBytes | undefined {
    const index = store.indexOf(id);
    return index >= 0 ? store.at(index) : undefined;
  }

  function selectedMembers(): RBytes[] {
    return [...selection.ids].map(lookup).filter((m): m is RBytes => m !== undefined);
  }

  async function deleteSelected() {
    const members = selectedMembers();
    if (members.length === 0 || ctx.readOnly) return;
    const ok = await confirm({
      title: t("editors.set.deleteTitle", { count: members.length }),
      details: members.slice(0, 12).map(label).concat(members.length > 12 ? [t("editors.table.andMore", { count: members.length - 12 })] : []),
      confirmLabel: t("common.delete"),
      danger: true,
    });
    if (!ok) return;
    try {
      const removed = await api.set.remove(cid, db, ctx.key, members);
      await editor?.revert(false);
      const cursor = selection.cursor;
      store.remove(new Set(members.map(bytesId)));
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

  async function copy(text: string) {
    try {
      await copyText(text);
      toast("success", t("common.copied"), { timeout: 1500 });
    } catch (err) {
      toastError(err);
    }
  }

  function copyJson() {
    void copy(JSON.stringify(selectedMembers().map(plain), null, 2));
  }

  function copySelection() {
    const members = selectedMembers();
    if (members.length === 1) void copy(plain(members[0]));
    else copyJson();
  }

  function onmenu(e: MouseEvent, index: number | null) {
    const member = index === null ? undefined : store.at(index);
    const items: MenuItem[] = [];
    if (member !== undefined) {
      items.push(
        { label: t("editors.set.editMember"), icon: Pencil, shortcut: "Enter", disabled: selection.size > 1, run: () => editor?.focus() },
        { kind: "separator" },
        { label: t("editors.set.copyMember"), icon: Copy, run: () => copy(plain(member)) },
        { label: t("editors.table.copyJson"), run: copyJson },
        { kind: "separator" },
        { label: t("editors.table.deleteSelected", { count: selection.size }), icon: Trash2, shortcut: "Delete", danger: true, disabled: ctx.readOnly, run: deleteSelected },
      );
    } else {
      items.push({ label: t("editors.set.add"), icon: Plus, disabled: ctx.readOnly, run: () => (adding = true) });
    }
    openContextMenu(e, items);
  }
</script>

<Bar>
  <FilterBox bind:term bind:caseSensitive placeholder={t("editors.set.filter")} onchange={onFilter} server />
  <span class="count tabular">
    {#if term}{t("editors.table.matched", { count: store.length })}{:else}{t("editors.table.loadedOf", { loaded: store.length, total: loader.total })}{/if}
  </span>
  {#if loader.loading}<Spinner size={12} />{/if}
  <span class="spacer"></span>
  {#if selection.size > 0 && !ctx.readOnly}
    <button class="btn ghost sm" onclick={deleteSelected} use:tooltip={{ text: t("editors.table.deleteSelected", { count: selection.size }), shortcut: "Delete" }}>
      <Trash2 size={13} />
      {fmtNumber(selection.size)}
    </button>
  {/if}
  {#if !ctx.readOnly}
    <button class="btn sm" onclick={() => (adding = true)} aria-label={t("editors.set.add")}><Plus size={13} /> <span class="label">{t("editors.set.add")}</span></button>
  {/if}
</Bar>

<SplitView bind:size={editorLayout.detail} showDetail={selection.size > 0}>
  <ItemTable
    bind:this={table}
    count={store.length}
    {selection}
    idAt={(i) => store.idAt(i)}
    columns="minmax(0, 1fr)"
    label={t("editors.set.tableLabel")}
    {beforeMove}
    onactivate={() => editor?.focus()}
    ondelete={deleteSelected}
    oncopy={copySelection}
    {onmenu}
  >
    {#snippet header()}
      <span class="hcell">{t("editors.set.member")}</span>
    {/snippet}
    {#snippet cell(index)}
      {@const member = store.at(index)}
      {#if member !== undefined}<span class="cell mono"><Highlight text={preview(member)} {matcher} /></span>{/if}
    {/snippet}
    {#snippet empty()}
      {#if loader.ready && !loader.loading}
        <EmptyState compact title={term ? t("editors.table.noMatch") : t("editors.set.empty")} description={term && !loader.done ? t("editors.table.scanMore") : undefined} />
      {/if}
    {/snippet}
    {#snippet footer()}
      <ListFooter loaded={store.length} total={loader.total} done={loader.done} loading={loader.loading} onmore={() => loader.more()} onall={() => loader.more(true)} onstop={() => loader.stop()} />
    {/snippet}
  </ItemTable>

  {#snippet detail()}
    {#if selection.size > 1}
      <MultiSummary count={selection.size} readOnly={ctx.readOnly} ondelete={deleteSelected} oncopy={copyJson} />
    {:else if current !== undefined && currentId}
      {#key currentId}
        <ValueEditor bind:this={editor} value={current} readOnly={ctx.readOnly} onsave={(next) => saveMember(current, next)} draftKey={`${ctx.scope}#m:${currentId}`} compact />
      {/key}
    {/if}
  {/snippet}
</SplitView>

{#if adding}
  <AddValuesDialog title={t("editors.set.addTitle")} onsubmit={addMembers} onclose={() => (adding = false)} />
{/if}

<style>
  .hcell {
    padding: 0 8px;
  }

  .cell {
    padding: 0 8px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
