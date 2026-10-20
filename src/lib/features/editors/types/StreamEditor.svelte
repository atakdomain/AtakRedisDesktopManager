<script lang="ts">
  // Stream: en yeni girdi üstte (XREVRANGE, sayfa sayfa), kimlikten zaman, alanlar. Girdiler değiştirilemez;
  // ekleme (XADD), silme (XDEL) ve tüketici grupları paneli.
  import Copy from "@lucide/svelte/icons/copy";
  import Plus from "@lucide/svelte/icons/plus";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import Users from "@lucide/svelte/icons/users";
  import { untrack } from "svelte";
  import { api, ApiError } from "$lib/api";
  import type { StreamEntry } from "$lib/api/types";
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
  import type { EditorContext } from "../context";
  import { editorLayout, saveViewMemory, viewMemory } from "../host.svelte";
  import Bar from "../table/Bar.svelte";
  import FilterBox from "../table/FilterBox.svelte";
  import Highlight from "../table/Highlight.svelte";
  import ItemTable from "../table/ItemTable.svelte";
  import ListFooter from "../table/ListFooter.svelte";
  import MultiSummary from "../table/MultiSummary.svelte";
  import { plain, preview } from "../table/preview";
  import { RowSelection, RowStore } from "../table/rows.svelte";
  import SplitView from "../table/SplitView.svelte";
  import StreamEntryDialog from "./StreamEntryDialog.svelte";
  import StreamGroups from "./StreamGroups.svelte";

  let { ctx }: { ctx: EditorContext } = $props();

  const PAGE = 100;
  // Bağlam bileşen ömrü boyunca sabittir (anahtar/db değişince KeyEditor yeniden bağlanır)
  const { cid, db, memoryKey } = untrack(() => ({ cid: ctx.ws.connectionId, db: ctx.ws.db, memoryKey: `${ctx.scope}#view` }));
  const memory = viewMemory(memoryKey, { term: "", caseSensitive: settings.caseSensitive, groups: false });

  let term = $state(memory.term);
  let caseSensitive = $state(memory.caseSensitive);
  let applied = $state({ term: memory.term, caseSensitive: memory.caseSensitive });
  let showGroups = $state(memory.groups);
  const matcher = $derived(applied.term ? compileMatcher({ mode: "contains", term: applied.term, caseSensitive: applied.caseSensitive }) : null);

  const store = new RowStore<StreamEntry>((e) => e.id);
  let total = $state(0);
  let done = $state(false);
  let loading = $state(false);
  let ready = $state(false);
  let adding = $state(false);
  let lastId = "";
  let generation = 0;
  let stopped = false;

  const visible = $derived.by(() => {
    const all = store.all();
    if (!matcher) return null;
    return all.filter((e) => matcher.test(e.id) || e.fields.some((f) => matcher.test(plain(f.field)) || matcher.test(plain(f.value))));
  });
  const count = $derived(visible ? visible.length : store.length);
  const entryAt = (row: number) => (visible ? visible[row] : store.at(row));

  const selection = new RowSelection(
    (row) => entryAt(row)?.id ?? "",
    () => count,
  );
  const current = $derived(selection.size <= 1 && selection.cursor >= 0 ? entryAt(selection.cursor) : undefined);

  function onError(err: unknown) {
    if (err instanceof ApiError && err.kind === "notFound") ctx.ongone();
    else ctx.ws.handleError(err);
  }

  async function more(all = false) {
    if (loading || done) return;
    const gen = generation;
    loading = true;
    stopped = false;
    try {
      do {
        // Bitiş dahil: son kimlikten bir fazla iste, tekrarı depo atar (6.2 öncesi sunucularda da çalışır)
        const requested = lastId ? PAGE + 1 : PAGE;
        const page = await api.stream.range(cid, db, ctx.key, "", lastId, requested, true);
        if (gen !== generation) return;
        total = page.total;
        ready = true;
        store.append(page.items);
        if (page.items.length) lastId = page.items[page.items.length - 1].id;
        done = page.items.length < requested;
      } while (all && !done && !stopped);
    } catch (err) {
      if (gen === generation) onError(err);
    } finally {
      if (gen === generation) loading = false;
    }
  }

  async function reload() {
    generation++;
    store.clear();
    lastId = "";
    done = false;
    ready = false;
    loading = false;
    selection.reset();
    await more();
    ctx.onlength(total);
  }

  void reload();

  $effect(() => () => saveViewMemory(memoryKey, { term, caseSensitive, groups: showGroups }));

  function onFilter() {
    selection.reset();
    applied = { term, caseSensitive };
  }

  function idTime(id: string): string {
    const ms = Number(id.split("-")[0]);
    return Number.isFinite(ms) ? new Date(ms).toLocaleString() : "";
  }

  function compareIds(a: string, b: string): number {
    const [am, as = "0"] = a.split("-");
    const [bm, bs = "0"] = b.split("-");
    const d = BigInt(am) - BigInt(bm);
    if (d !== 0n) return d > 0n ? 1 : -1;
    const s = BigInt(as) - BigInt(bs);
    return s === 0n ? 0 : s > 0n ? 1 : -1;
  }

  function onadded(id: string, fields: { field: string; value: string }[]) {
    total++;
    ctx.onlength(total);
    const newest = store.at(0);
    if (!newest || compareIds(id, newest.id) > 0) {
      store.prepend({ id, fields });
      selection.single(0);
    } else void reload();
    toast("success", t("editors.stream.added", { id }), { timeout: 2500 });
  }

  function selectedEntries(): StreamEntry[] {
    const out: StreamEntry[] = [];
    for (let row = 0; row < count && out.length < selection.size; row++) {
      const entry = entryAt(row);
      if (entry && selection.has(entry.id)) out.push(entry);
    }
    return out;
  }

  async function deleteSelected() {
    const entries = selectedEntries();
    if (entries.length === 0 || ctx.readOnly) return;
    const ok = await confirm({
      title: t("editors.stream.deleteTitle", { count: entries.length }),
      details: entries.slice(0, 12).map((e) => e.id),
      confirmLabel: t("common.delete"),
      danger: true,
    });
    if (!ok) return;
    try {
      const removed = await api.stream.remove(
        cid,
        db,
        ctx.key,
        entries.map((e) => e.id),
      );
      const cursor = selection.cursor;
      store.remove(new Set(entries.map((e) => e.id)));
      total = Math.max(0, total - removed);
      ctx.onlength(total);
      if (count > 0) selection.single(Math.min(cursor, count - 1));
      else selection.reset();
    } catch (err) {
      toastError(err);
    }
  }

  function entryJson(entry: StreamEntry) {
    return { id: entry.id, fields: Object.fromEntries(entry.fields.map((f) => [plain(f.field), plain(f.value)])) };
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
    const entries = selectedEntries().map(entryJson);
    void copy(JSON.stringify(entries.length === 1 ? entries[0] : entries, null, 2));
  }

  function onmenu(e: MouseEvent, row: number | null) {
    const entry = row === null ? undefined : entryAt(row);
    const items: MenuItem[] = [];
    if (entry) {
      items.push(
        { label: t("editors.stream.copyId"), icon: Copy, run: () => copy(entry.id) },
        { label: t("editors.table.copyJson"), run: copyJson },
        { kind: "separator" },
        { label: t("editors.table.deleteSelected", { count: selection.size }), icon: Trash2, shortcut: "Delete", danger: true, disabled: ctx.readOnly, run: deleteSelected },
      );
    } else {
      items.push({ label: t("editors.stream.add"), icon: Plus, disabled: ctx.readOnly, run: () => (adding = true) });
    }
    openContextMenu(e, items);
  }

  function fieldsPreview(entry: StreamEntry): string {
    return entry.fields.map((f) => `${preview(f.field)}=${preview(f.value)}`).join("  ·  ");
  }
</script>

<Bar>
  <FilterBox bind:term bind:caseSensitive placeholder={t("editors.stream.filter")} onchange={onFilter} />
  <span class="count tabular">
    {#if visible}
      {t("editors.list.filteredLoaded", { count, loaded: store.length, total })}
    {:else}
      {t("editors.table.loadedOf", { loaded: store.length, total })}
    {/if}
  </span>
  {#if loading}<Spinner size={12} />{/if}
  <span class="spacer"></span>
  {#if selection.size > 0 && !ctx.readOnly}
    <button class="btn ghost sm" onclick={deleteSelected} use:tooltip={{ text: t("editors.table.deleteSelected", { count: selection.size }), shortcut: "Delete" }}>
      <Trash2 size={13} />
      {fmtNumber(selection.size)}
    </button>
  {/if}
  <button class="btn ghost sm" class:on={showGroups} aria-pressed={showGroups} aria-label={t("editors.stream.groups")} onclick={() => (showGroups = !showGroups)}><Users size={13} /> <span class="label">{t("editors.stream.groups")}</span></button>
  {#if !ctx.readOnly}
    <button class="btn sm" onclick={() => (adding = true)} aria-label={t("editors.stream.add")}><Plus size={13} /> <span class="label">{t("editors.stream.add")}</span></button>
  {/if}
</Bar>

<div class="body">
  <div class="main">
    <SplitView bind:size={editorLayout.detail} showDetail={selection.size > 0}>
      <ItemTable
        {count}
        {selection}
        idAt={(row) => entryAt(row)?.id ?? ""}
        columns="minmax(110px, 190px) minmax(0, 150px) minmax(0, 1fr)"
        label={t("editors.stream.tableLabel")}
        ondelete={deleteSelected}
        oncopy={copyJson}
        {onmenu}
      >
        {#snippet header()}
          <span class="hcell">{t("editors.stream.id")}</span>
          <span class="hcell">{t("editors.stream.time")}</span>
          <span class="hcell">{t("editors.stream.fields")}</span>
        {/snippet}
        {#snippet cell(row)}
          {@const entry = entryAt(row)}
          {#if entry}
            <span class="cell mono"><Highlight text={entry.id} {matcher} /></span>
            <span class="cell muted tabular">{idTime(entry.id)}</span>
            <span class="cell mono"><Highlight text={fieldsPreview(entry)} {matcher} /></span>
          {/if}
        {/snippet}
        {#snippet empty()}
          {#if ready && !loading}
            <EmptyState compact title={visible ? t("editors.table.noMatch") : t("editors.stream.empty")} description={visible && !done ? t("editors.list.filterLoadedHint") : undefined} />
          {/if}
        {/snippet}
        {#snippet footer()}
          <ListFooter
            loaded={store.length}
            {total}
            {done}
            {loading}
            onmore={() => more()}
            onall={() => more(true)}
            onstop={() => {
              stopped = true;
            }}
          />
        {/snippet}
      </ItemTable>

      {#snippet detail()}
        {#if selection.size > 1}
          <MultiSummary count={selection.size} readOnly={ctx.readOnly} ondelete={deleteSelected} oncopy={copyJson} />
        {:else if current}
          <div class="entry">
            <div class="entry-head">
              <span class="mono selectable">{current.id}</span>
              <span class="muted">{idTime(current.id)}</span>
              <span class="grow"></span>
              <span class="muted">{t("editors.stream.readOnlyEntry")}</span>
              <button class="btn ghost sm" onclick={copyJson}><Copy size={13} /> {t("editors.table.copyJson")}</button>
            </div>
            <div class="entry-fields">
              {#each current.fields as f, i (i)}
                <div class="f-name mono selectable">{plain(f.field)}</div>
                <div class="f-value mono selectable">{plain(f.value)}</div>
              {/each}
            </div>
          </div>
        {/if}
      {/snippet}
    </SplitView>
  </div>
  {#if showGroups}
    <Resizer bind:width={editorLayout.groups} min={200} max={520} initial={280} side="right" />
    <div class="side" style:width="min({editorLayout.groups}px, 45%)">
      <StreamGroups connectionId={cid} {db} keyName={ctx.key} onclose={() => (showGroups = false)} />
    </div>
  {/if}
</div>

{#if adding}
  <StreamEntryDialog connectionId={cid} {db} keyName={ctx.key} {onadded} onclose={() => (adding = false)} />
{/if}

<style>
  .body {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  .main {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  .side {
    flex: none;
    min-width: 0;
  }

  .hcell {
    padding: 0 8px;
  }

  .cell {
    padding: 0 8px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .btn.on {
    background: var(--accent-soft);
    color: var(--accent-text);
  }

  .entry {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .entry-head {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: none;
    height: 34px;
    padding: 0 8px 0 10px;
    border-bottom: 1px solid var(--border-subtle);
    font-size: var(--fs-sm);
  }

  .entry-fields {
    display: grid;
    grid-template-columns: minmax(80px, max-content) minmax(0, 1fr);
    align-content: start;
    gap: 0;
    flex: 1;
    overflow: auto;
    font-size: var(--fs-mono);
  }

  .f-name,
  .f-value {
    padding: 5px 10px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .f-name {
    color: var(--accent-text);
    font-weight: 500;
    white-space: nowrap;
  }

  .f-value {
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
