<script lang="ts">
  // Sorted set: sıra | skor | üye. Süzgeç yokken sıra tabanlı tembel sayfalama (ZRANGE / ZREVRANGE),
  // süzgeç varken ZSCAN (sunucu) ve yüklenenler skora göre sıralanır.
  import ArrowDownWideNarrow from "@lucide/svelte/icons/arrow-down-wide-narrow";
  import ArrowUpNarrowWide from "@lucide/svelte/icons/arrow-up-narrow-wide";
  import Copy from "@lucide/svelte/icons/copy";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Plus from "@lucide/svelte/icons/plus";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import { tick, untrack } from "svelte";
  import { api, ApiError } from "$lib/api";
  import { bytesId, label } from "$lib/api/bytes";
  import type { RBytes, ZEntry } from "$lib/api/types";
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
  import Bar from "../table/Bar.svelte";
  import FilterBox from "../table/FilterBox.svelte";
  import Highlight from "../table/Highlight.svelte";
  import ItemTable from "../table/ItemTable.svelte";
  import ListFooter from "../table/ListFooter.svelte";
  import MultiSummary from "../table/MultiSummary.svelte";
  import { PagedLoader } from "../table/paged.svelte";
  import { plain, preview } from "../table/preview";
  import { RowSelection } from "../table/rows.svelte";
  import { ScanLoader, SCAN_COUNT } from "../table/scan.svelte";
  import SplitView from "../table/SplitView.svelte";
  import ValueEditor from "../value/ValueEditor.svelte";

  let { ctx }: { ctx: EditorContext } = $props();

  // Bağlam bileşen ömrü boyunca sabittir (anahtar/db değişince KeyEditor yeniden bağlanır)
  const { cid, db, memoryKey } = untrack(() => ({ cid: ctx.ws.connectionId, db: ctx.ws.db, memoryKey: `${ctx.scope}#view` }));
  const memory = viewMemory(memoryKey, { term: "", caseSensitive: settings.caseSensitive, desc: true, cursorId: null as string | null });

  let term = $state(memory.term);
  let caseSensitive = $state(memory.caseSensitive);
  let applied = $state({ term: memory.term, caseSensitive: memory.caseSensitive });
  let desc = $state(memory.desc);
  const matcher = $derived(applied.term ? compileMatcher({ mode: "contains", term: applied.term, caseSensitive: applied.caseSensitive }) : null);

  const paged = new PagedLoader<ZEntry>((start, count) => api.zset.range(cid, db, ctx.key, start, count, desc), onError);
  const loader = new ScanLoader<ZEntry>(
    (e) => bytesId(e.member),
    (cursor) => api.zset.scan(cid, db, ctx.key, cursor, valueFilter(applied.term, applied.caseSensitive), SCAN_COUNT),
    onError,
  );

  const scanMode = $derived(!!applied.term);
  const sorted = $derived(scanMode ? [...loader.store.all()].sort((a, b) => (desc ? b.score - a.score : a.score - b.score)) : null);
  const count = $derived(sorted ? sorted.length : paged.total);
  const total = $derived(scanMode ? loader.total : paged.total);
  const entryAt = (row: number): ZEntry | undefined => (sorted ? sorted[row] : paged.at(row));
  const idAt = (row: number) => {
    const entry = entryAt(row);
    return entry ? bytesId(entry.member) : `#${row}`;
  };

  const selection = new RowSelection(idAt, () => count);

  let table = $state<ItemTable>();
  let editor = $state<ValueEditor>();
  let scoreInput = $state<HTMLInputElement>();
  let adding = $state(false);
  let scoreDraft = $state("0");

  const current = $derived(!adding && selection.size <= 1 && selection.cursor >= 0 ? entryAt(selection.cursor) : undefined);
  const currentId = $derived(current ? bytesId(current.member) : null);
  const scoreText = $derived(current ? String(current.score) : "0");

  $effect(() => {
    const text = scoreText;
    untrack(() => {
      if (!adding) scoreDraft = text;
    });
  });

  function onError(err: unknown) {
    if (err instanceof ApiError && err.kind === "notFound") ctx.ongone();
    else ctx.ws.handleError(err);
  }

  /** Bir üyeyi yüklenen satırlarda bulup seçer */
  function selectMember(id: string | null) {
    if (!id) return selection.reset();
    let row = -1;
    if (sorted) row = sorted.findIndex((e) => bytesId(e.member) === id);
    else row = paged.loadedEntries().find((e) => bytesId(e.item.member) === id)?.index ?? -1;
    if (row >= 0) {
      selection.single(row);
      table?.scrollToIndex(row);
    } else selection.reset();
  }

  async function reload() {
    if (scanMode) await loader.reset();
    else {
      await paged.reset();
      if (paged.ready) {
        ctx.onlength(paged.total);
        if (paged.total === 0) ctx.ongone();
      }
    }
  }

  void reload().then(() => {
    selectMember(memory.cursorId);
    memory.cursorId = null;
  });

  $effect(() => () => saveViewMemory(memoryKey, { term, caseSensitive, desc, cursorId: selection.cursorId() }));

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

  async function onFilter() {
    if (!(await beforeMove())) return;
    selection.reset();
    applied = { term, caseSensitive };
    await reload();
  }

  async function toggleSort() {
    if (!(await beforeMove())) return;
    const keep = selection.cursorId();
    desc = !desc;
    if (!scanMode) await paged.reset();
    selectMember(keep);
  }

  function parseScore(text: string): number {
    const trimmed = text.trim();
    const score = Number(trimmed);
    if (!trimmed || !Number.isFinite(score)) throw new Error(t("editors.zset.badScore"));
    return score;
  }

  /** Değişiklikten sonra: süzgeçsizken sıralama değiştiğinden sayfalar yeniden yüklenir */
  async function refreshAfterChange(selectId: string | null) {
    if (!scanMode) await paged.reset();
    selectMember(selectId);
  }

  async function saveEntry(entry: ZEntry, member: RBytes) {
    const score = parseScore(scoreDraft);
    const renamed = bytesId(member) !== bytesId(entry.member);
    if (renamed && (loader.store.has(bytesId(member)) || paged.loadedEntries().some((e) => bytesId(e.item.member) === bytesId(member)))) {
      const ok = await confirm({ title: t("editors.zset.existsTitle"), message: t("editors.zset.existsMessage"), confirmLabel: t("editors.zset.overwrite"), danger: true });
      if (!ok) throw new ApiError("cancelled", "");
    }
    await api.zset.add(cid, db, ctx.key, member, score, renamed ? entry.member : null);
    if (scanMode) loader.store.replace(bytesId(entry.member), { member, score });
    await refreshAfterChange(bytesId(member));
  }

  async function startAdd() {
    if (ctx.readOnly || !(await beforeMove())) return;
    selection.reset();
    scoreDraft = "0";
    adding = true;
    void tick().then(() => editor?.focus());
  }

  async function saveNew(member: RBytes) {
    const score = parseScore(scoreDraft);
    await api.zset.add(cid, db, ctx.key, member, score, null);
    adding = false;
    if (scanMode) loader.store.append([{ member, score }]);
    await refreshAfterChange(bytesId(member));
    if (!scanMode) ctx.onlength(paged.total);
  }

  function selectedEntries(): ZEntry[] {
    const out: ZEntry[] = [];
    for (let row = 0; row < count && out.length < selection.size; row++) {
      const entry = entryAt(row);
      if (entry && selection.has(bytesId(entry.member))) out.push(entry);
    }
    return out;
  }

  async function deleteSelected() {
    const entries = selectedEntries();
    if (entries.length === 0 || ctx.readOnly) return;
    const ok = await confirm({
      title: t("editors.zset.deleteTitle", { count: entries.length }),
      details: entries.slice(0, 12).map((e) => `${e.score}  ${label(e.member)}`),
      confirmLabel: t("common.delete"),
      danger: true,
    });
    if (!ok) return;
    try {
      const removed = await api.zset.remove(
        cid,
        db,
        ctx.key,
        entries.map((e) => e.member),
      );
      await editor?.revert(false);
      selection.reset();
      if (scanMode) {
        loader.store.remove(new Set(entries.map((e) => bytesId(e.member))));
        loader.total = Math.max(0, loader.total - removed);
      } else await paged.reset();
      const left = scanMode ? loader.total : paged.total;
      ctx.onlength(left);
      if (left === 0) {
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
    void copy(JSON.stringify(selectedEntries().map((e) => ({ member: plain(e.member), score: e.score })), null, 2));
  }

  function copySelection() {
    const entries = selectedEntries();
    if (entries.length === 1) void copy(plain(entries[0].member));
    else copyJson();
  }

  function onmenu(e: MouseEvent, row: number | null) {
    const entry = row === null ? undefined : entryAt(row);
    const items: MenuItem[] = [];
    if (entry) {
      items.push(
        { label: t("editors.zset.editMember"), icon: Pencil, shortcut: "Enter", disabled: selection.size > 1, run: () => editor?.focus() },
        { label: t("editors.zset.editScore"), disabled: ctx.readOnly || selection.size > 1, run: () => scoreInput?.select() },
        { kind: "separator" },
        { label: t("editors.zset.copyMember"), icon: Copy, run: () => copy(plain(entry.member)) },
        { label: t("editors.zset.copyScore"), run: () => copy(String(entry.score)) },
        { label: t("editors.table.copyJson"), run: copyJson },
        { kind: "separator" },
        { label: t("editors.table.deleteSelected", { count: selection.size }), icon: Trash2, shortcut: "Delete", danger: true, disabled: ctx.readOnly, run: deleteSelected },
      );
    } else {
      items.push({ label: t("editors.zset.add"), icon: Plus, disabled: ctx.readOnly, run: startAdd });
    }
    openContextMenu(e, items);
  }
</script>

<Bar>
  <FilterBox bind:term bind:caseSensitive placeholder={t("editors.zset.filter")} onchange={onFilter} server />
  <span class="count tabular">
    {#if scanMode}{t("editors.table.matched", { count })}{:else}{t("editors.meta.members", { count: total })}{/if}
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
    <button class="btn sm" onclick={startAdd} aria-label={t("editors.zset.add")}><Plus size={13} /> <span class="label">{t("editors.zset.add")}</span></button>
  {/if}
</Bar>

<SplitView bind:size={editorLayout.detail} showDetail={adding || selection.size > 0}>
  <ItemTable
    bind:this={table}
    {count}
    {selection}
    {idAt}
    columns="48px minmax(64px, 120px) minmax(0, 1fr)"
    label={t("editors.zset.tableLabel")}
    {beforeMove}
    onactivate={() => editor?.focus()}
    ondelete={deleteSelected}
    oncopy={copySelection}
    {onmenu}
    onrange={(start, end) => {
      if (!scanMode) paged.ensure(start, end);
    }}
  >
    {#snippet header()}
      <span class="hcell num">#</span>
      <button class="hcell sort" onclick={toggleSort} use:tooltip={desc ? t("editors.zset.sortDesc") : t("editors.zset.sortAsc")}>
        <span>{t("editors.zset.score")}</span>
        {#if desc}<ArrowDownWideNarrow size={13} />{:else}<ArrowUpNarrowWide size={13} />{/if}
      </button>
      <span class="hcell">{t("editors.set.member")}</span>
    {/snippet}
    {#snippet cell(row)}
      {@const entry = entryAt(row)}
      <span class="cell num tabular">{row + 1}</span>
      {#if entry}
        <span class="cell mono score tabular">{entry.score}</span>
        <span class="cell mono"><Highlight text={preview(entry.member)} {matcher} /></span>
      {:else}
        <span class="cell"><span class="placeholder"></span></span>
        <span class="cell"><span class="placeholder"></span></span>
      {/if}
    {/snippet}
    {#snippet empty()}
      {#if (scanMode ? loader.ready && !loader.loading : paged.ready)}
        <EmptyState compact title={scanMode ? t("editors.table.noMatch") : t("editors.zset.empty")} description={scanMode && !loader.done ? t("editors.table.scanMore") : undefined} />
      {/if}
    {/snippet}
    {#snippet footer()}
      {#if scanMode}
        <ListFooter loaded={count} total={loader.total} done={loader.done} loading={loader.loading} onmore={() => loader.more()} onall={() => loader.more(true)} onstop={() => loader.stop()} />
      {/if}
    {/snippet}
  </ItemTable>

  {#snippet detail()}
    {#snippet scoreField(id: string)}
      <div class="detail-field">
        <label for={id}>{t("editors.zset.score")}</label>
        <input
          {id}
          bind:this={scoreInput}
          class="input sm mono score-input"
          bind:value={scoreDraft}
          inputmode="decimal"
          readonly={ctx.readOnly}
          spellcheck="false"
          autocomplete="off"
          onkeydown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void editor?.save();
            }
          }}
        />
        <span class="hint">{adding ? t("editors.zset.newHint") : t("editors.zset.memberHint")}</span>
      </div>
    {/snippet}
    {#if adding}
      <ValueEditor bind:this={editor} value="" onsave={saveNew} extraDirty onrevert={() => (adding = false)} compact>
        {#snippet header()}{@render scoreField("zset-new-score")}{/snippet}
      </ValueEditor>
    {:else if selection.size > 1}
      <MultiSummary count={selection.size} readOnly={ctx.readOnly} ondelete={deleteSelected} oncopy={copyJson} />
    {:else if current && currentId}
      {#key currentId}
        <ValueEditor
          bind:this={editor}
          value={current.member}
          readOnly={ctx.readOnly}
          onsave={(m) => saveEntry(current, m)}
          extraDirty={scoreDraft !== scoreText}
          onrevert={() => (scoreDraft = scoreText)}
          draftKey={`${ctx.scope}#z:${currentId}`}
          compact
        >
          {#snippet header()}{@render scoreField("zset-score")}{/snippet}
        </ValueEditor>
      {/key}
    {/if}
  {/snippet}
</SplitView>

<style>
  .hcell {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 100%;
    padding: 0 8px;
  }

  .sort {
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .sort:hover {
    color: var(--text);
    background: var(--bg-hover);
  }

  .num {
    justify-content: flex-end;
    text-align: right;
    color: var(--text-3);
  }

  .cell {
    padding: 0 8px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .score {
    color: var(--type-zset);
  }

  .placeholder {
    display: block;
    height: 8px;
    border-radius: 4px;
    background: var(--bg-hover);
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
  }

  .score-input {
    width: 180px;
  }

  .hint {
    margin-left: 4px;
  }
</style>
