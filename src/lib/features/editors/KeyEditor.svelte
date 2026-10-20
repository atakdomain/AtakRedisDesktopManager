<script lang="ts">
  // Etkin anahtar sekmesinin ana paneli: başlık hemen çizilir, anahtar bilgisi ve değer arkadan gelir.
  // Sekme değişince yeniden bağlanır; kaydedilmemiş değişiklikler taslak olarak saklanır (host.svelte.ts).
  import Copy from "@lucide/svelte/icons/copy";
  import Hourglass from "@lucide/svelte/icons/hourglass";
  import Pencil from "@lucide/svelte/icons/pencil";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Save from "@lucide/svelte/icons/save";
  import SearchX from "@lucide/svelte/icons/search-x";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import { onDestroy, untrack } from "svelte";
  import { api, ApiError } from "$lib/api";
  import { bytesId, label } from "$lib/api/bytes";
  import type { KeyInfo, KeyType } from "$lib/api/types";
  import { t } from "$lib/i18n/index.svelte";
  import { useCommands } from "$lib/state/commands.svelte";
  import { confirm } from "$lib/state/dialogs.svelte";
  import { toast, toastError } from "$lib/state/toasts.svelte";
  import { keyTabId, type Tab, type Workspace } from "$lib/state/workspace.svelte";
  import EmptyState from "$lib/ui/EmptyState.svelte";
  import Spinner from "$lib/ui/Spinner.svelte";
  import { copyText } from "$lib/util/clipboard";
  import type { EditorContext } from "./context";
  import KeyHeader from "./header/KeyHeader.svelte";
  import { EditorHost, hasDrafts, moveScope, provideHost } from "./host.svelte";
  import { describeError } from "./messages";
  import { parseName } from "./names";
  import HashEditor from "./types/HashEditor.svelte";
  import JsonEditor from "./types/JsonEditor.svelte";
  import ListEditor from "./types/ListEditor.svelte";
  import SetEditor from "./types/SetEditor.svelte";
  import StreamEditor from "./types/StreamEditor.svelte";
  import StringEditor from "./types/StringEditor.svelte";
  import ZSetEditor from "./types/ZSetEditor.svelte";

  let { ws, tab }: { ws: Workspace; tab: Tab } = $props();

  // Sekme anahtarı bu bileşenin ömrü boyunca sabittir (yeniden adlandırma sekme kimliğini değiştirip yeniden bağlar)
  const key = untrack(() => tab.key!);
  const id = bytesId(key);
  const { cid, db } = untrack(() => ({ cid: ws.connectionId, db: ws.db }));
  const scope = `${cid}/${db}/${id}`;

  const host = new EditorHost();
  provideHost(host);

  let root = $state<HTMLDivElement>();
  let header = $state<KeyHeader>();
  let type = $state<KeyType | undefined>(untrack(() => ws.metaOf(id)?.type ?? tab.keyType));
  let info = $state.raw<KeyInfo | null>(null);
  let infoError = $state<string | null>(null);
  let ttl = $state<number | null>(null);
  let length = $state<number | null>(null);
  let gone = $state(false);
  let refreshing = $state(false);
  let generation = $state(0);

  const readOnly = $derived(ws.readOnly);

  async function loadInfo(): Promise<void> {
    try {
      const result = await api.keys.info(cid, db, key);
      if (result.type === "none") return markGone();
      info = result;
      infoError = null;
      type = result.type;
      ttl = result.ttl;
      length = result.type === "ReJSON-RL" ? null : result.length;
      ws.setMeta(id, { type: result.type, ttl: result.ttl });
    } catch (err) {
      if (err instanceof ApiError && err.kind === "notFound") return markGone();
      infoError = describeError(err);
      ws.handleError(err, false);
    }
  }

  function markGone() {
    gone = true;
    host.discardAll();
    ws.setMeta(id, { type: "none", ttl: -2 });
  }

  void loadInfo();

  const ctx: EditorContext = {
    ws: untrack(() => ws),
    key,
    scope,
    get readOnly() {
      return ws.readOnly;
    },
    onlength: (n) => {
      if (type !== "ReJSON-RL") length = n;
    },
    ongone: markGone,
  };

  // Sekme kirliliği: düzenleyici açıkken canlı; kapanırken bekleyen taslaklara göre (alt bileşenler önce kapanır)
  $effect(() => {
    const dirty = host.dirty;
    untrack(() => {
      tab.dirty = dirty;
      if (dirty && tab.preview) ws.pinTab(tab.id);
    });
  });
  onDestroy(() => {
    tab.dirty = hasDrafts(scope);
  });

  async function refresh() {
    if (host.dirty) {
      const ok = await confirm({ title: t("editors.value.discardTitle"), message: t("editors.key.refreshDiscard"), confirmLabel: t("editors.value.discard"), danger: true });
      if (!ok) return;
      host.discardAll();
    }
    refreshing = true;
    gone = false;
    await loadInfo();
    generation++;
    refreshing = false;
  }

  async function rename(text: string): Promise<boolean> {
    const next = parseName(text, key);
    if (bytesId(next) === id) return true;
    try {
      try {
        await api.keys.rename(cid, db, key, next, false);
      } catch (err) {
        if (!(err instanceof ApiError && err.kind === "exists")) throw err;
        const ok = await confirm({
          title: t("editors.key.overwriteTitle"),
          message: t("editors.key.overwriteMessage"),
          details: [label(next)],
          confirmLabel: t("editors.key.overwrite"),
          danger: true,
        });
        if (!ok) return false;
        await api.keys.rename(cid, db, key, next, true);
        // Üzerine yazılan hedefin açık sekmesi artık eski değeri gösterir: kapat
        const target = keyTabId(next);
        if (ws.tabs.some((x) => x.id === target)) ws.closeTab(target);
      }
      moveScope(scope, `${cid}/${db}/${bytesId(next)}`);
      ws.renameKey(key, next);
      return true;
    } catch (err) {
      toastError(err, t("editors.key.renameFailed"));
      return false;
    }
  }

  async function setTtl(ms: number): Promise<boolean> {
    try {
      await api.keys.expire(cid, db, key, ms);
      ttl = ms > 0 ? ms : -1;
      if (type) ws.setMeta(id, { type, ttl });
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.kind === "notFound") markGone();
      else toastError(err);
      return false;
    }
  }

  async function remove() {
    const ok = await confirm({ title: t("editors.key.deleteTitle"), message: t("editors.key.deleteMessage"), details: [label(key)], confirmLabel: t("common.delete"), danger: true });
    if (!ok) return;
    try {
      await api.keys.remove(cid, db, [key]);
      host.discardAll();
      ws.removeKeys([id]);
      toast("success", t("editors.key.deleted"), { timeout: 2000 });
    } catch (err) {
      toastError(err);
    }
  }

  async function copyName() {
    try {
      await copyText(label(key));
      toast("success", t("common.copied"), { timeout: 1500 });
    } catch (err) {
      toastError(err);
    }
  }

  /** Kısayollar yalnızca odak bu paneldeyken (ya da hiçbir yerde değilken) — anahtar listesinin F2'si bozulmasın */
  function focusHere(): boolean {
    const active = document.activeElement;
    return !active || active === document.body || !!root?.contains(active);
  }

  const group = () => t("editors.commands.group");
  useCommands([
    { id: "editor-save", title: () => t("common.save"), group, icon: Save, shortcut: "Mod+S", inInputs: true, when: () => host.dirty, run: () => host.saveActive() },
    { id: "editor-refresh", title: () => t("editors.commands.refresh"), group, icon: RefreshCw, shortcut: "F5", inInputs: true, when: focusHere, run: refresh },
    { id: "editor-rename", title: () => t("editors.commands.rename"), group, icon: Pencil, shortcut: "F2", when: () => focusHere() && !readOnly && !gone, run: () => header?.startRename() },
    { id: "editor-ttl", title: () => t("editors.commands.ttl"), group, icon: Hourglass, when: () => !readOnly && !gone, run: () => header?.openTtl() },
    { id: "editor-copy-name", title: () => t("editors.commands.copyName"), group, icon: Copy, run: copyName },
    { id: "editor-delete", title: () => t("editors.commands.delete"), group, icon: Trash2, when: () => !readOnly && !gone, run: remove },
  ]);
</script>

<div class="editor" bind:this={root}>
  <KeyHeader
    bind:this={header}
    keyName={key}
    {type}
    {info}
    {length}
    {ttl}
    {readOnly}
    {gone}
    {refreshing}
    onrename={rename}
    onttl={setTtl}
    onexpired={() => void loadInfo()}
    onrefresh={refresh}
    ondelete={remove}
  />

  <div class="content">
    {#if gone}
      <EmptyState icon={SearchX} title={t("editors.gone.title")} description={t("editors.gone.text")}>
        <button class="btn" onclick={refresh}><RefreshCw size={14} /> {t("common.refresh")}</button>
        <button class="btn primary" onclick={() => ws.removeKeys([id])}>{t("editors.gone.close")}</button>
      </EmptyState>
    {:else if !type}
      {#if infoError}
        <EmptyState icon={TriangleAlert} title={t("editors.loadFailed")} description={infoError}>
          <button class="btn" onclick={refresh}>{t("common.retry")}</button>
        </EmptyState>
      {:else}
        <div class="loading"><Spinner size={16} /></div>
      {/if}
    {:else}
      {#key generation}
        {#if type === "string"}
          <StringEditor {ctx} size={info ? info.length : infoError ? -1 : null} />
        {:else if type === "hash"}
          <HashEditor {ctx} />
        {:else if type === "list"}
          <ListEditor {ctx} />
        {:else if type === "set"}
          <SetEditor {ctx} />
        {:else if type === "zset"}
          <ZSetEditor {ctx} />
        {:else if type === "stream"}
          <StreamEditor {ctx} />
        {:else if type === "ReJSON-RL"}
          <JsonEditor {ctx} />
        {:else}
          <EmptyState icon={TriangleAlert} title={t("editors.unsupported.title", { type })} description={t("editors.unsupported.text")} />
        {/if}
      {/key}
    {/if}
  </div>
</div>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--bg);
  }

  .content {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .loading {
    display: grid;
    place-items: center;
    flex: 1;
    color: var(--text-3);
  }
</style>
