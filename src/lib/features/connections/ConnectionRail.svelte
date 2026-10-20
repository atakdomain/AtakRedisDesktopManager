<script lang="ts">
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Download from "@lucide/svelte/icons/download";
  import PanelLeftClose from "@lucide/svelte/icons/panel-left-close";
  import PanelLeftOpen from "@lucide/svelte/icons/panel-left-open";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Plus from "@lucide/svelte/icons/plus";
  import Search from "@lucide/svelte/icons/search";
  import Server from "@lucide/svelte/icons/server";
  import X from "@lucide/svelte/icons/x";
  import { onMount, tick, untrack } from "svelte";
  import type { ConnectionConfig } from "$lib/api/types";
  import { t } from "$lib/i18n/index.svelte";
  import { registerCommands, type Command } from "$lib/state/commands.svelte";
  import { connections, emptyConnection } from "$lib/state/connections.svelte";
  import { openContextMenu, openMenu } from "$lib/state/menu.svelte";
  import { toastError } from "$lib/state/toasts.svelte";
  import { layout, ui } from "$lib/state/ui.svelte";
  import EmptyState from "$lib/ui/EmptyState.svelte";
  import { tooltip } from "$lib/ui/tooltip.svelte";
  import { connectionMenu, connectTo, deleteConnection, editConnection } from "./actions.svelte";
  import ConnectionIcons from "./ConnectionIcons.svelte";
  import { accentColor, address, displayName, initials, matchesQuery, visualOrder } from "./connectionInfo";
  import { describeConnectionError } from "./errors";
  import { isGroupCollapsed, loadPrefs, toggleGroup } from "./prefs.svelte";
  import { moveConnection, type DropTarget } from "./reorder";

  type Entry =
    | { kind: "group"; key: string; name: string; count: number; open: boolean; status: string }
    | { kind: "conn"; key: string; config: ConnectionConfig; group: string };

  const SEARCH_THRESHOLD = 6;

  let query = $state("");
  let cursor = $state<string | null>(null);
  let listEl = $state<HTMLDivElement>();
  let searchEl = $state<HTMLInputElement>();

  let dragId = $state<string | null>(null);
  let drop = $state<{ key: string; pos: "before" | "after" | "into" } | null>(null);

  const collapsed = $derived(layout.railCollapsed);
  const ordered = $derived(visualOrder(connections.list));
  const searching = $derived(query.trim() !== "");
  const showSearch = $derived(connections.list.length > SEARCH_THRESHOLD);
  const filtered = $derived(searching ? ordered.filter((c) => matchesQuery(c, query)) : ordered);

  function statusOf(id: string): string {
    return connections.status[id] ?? "idle";
  }

  /** Nokta ipucu: durum; hatada hatanın kısa açıklaması */
  function statusText(status: string, config?: ConnectionConfig): string {
    const error = config ? connections.errors[config.id] : undefined;
    if (status === "error" && error && config) return describeConnectionError(error, config).title;
    return t(`connections.status.${status as "connecting" | "connected" | "error"}`);
  }

  /** Kapalı grubun başlığında gösterilecek en önemli durum */
  function groupStatus(members: ConnectionConfig[]): string {
    const statuses = members.map((c) => statusOf(c.id));
    for (const s of ["error", "connecting", "connected"]) if (statuses.includes(s)) return s;
    return "idle";
  }

  const entries = $derived.by((): Entry[] => {
    const out: Entry[] = [];
    for (const c of filtered) if (!c.group) out.push({ kind: "conn", key: `c:${c.id}`, config: c, group: "" });
    const groups = [...new Set(filtered.map((c) => c.group).filter(Boolean))];
    for (const name of groups) {
      const members = filtered.filter((c) => c.group === name);
      const open = searching || !isGroupCollapsed(name);
      out.push({ kind: "group", key: `g:${name}`, name, count: members.length, open, status: open ? "idle" : groupStatus(members) });
      if (open) for (const c of members) out.push({ kind: "conn", key: `c:${c.id}`, config: c, group: name });
    }
    return out;
  });

  /** Gezinmede sekme sırası alan tek satır (roving tabindex) */
  const tabKey = $derived.by(() => {
    if (cursor && entries.some((e) => e.key === cursor)) return cursor;
    const active = entries.find((e) => e.kind === "conn" && e.config.id === connections.activeId);
    return active?.key ?? entries[0]?.key ?? null;
  });

  onMount(() => {
    void loadPrefs();
  });

  // Komut paleti: "X bağlantısına geç" + Ctrl+1…9
  $effect(() => {
    const list = visualOrder(connections.list);
    const commands: Command[] = list.map((c, i) => ({
      id: `connection-switch:${c.id}`,
      title: () => t("connections.commands.switchTo", { name: displayName(c) }),
      group: () => t("shell.palette.groups.connection"),
      icon: Server,
      shortcut: i < 9 ? `Mod+${i + 1}` : undefined,
      inInputs: true,
      run: () => connectTo(c.id),
    }));
    commands.push(
      {
        id: "connection-toggle-rail",
        title: () => t("connections.commands.toggleRail"),
        group: () => t("shell.palette.groups.view"),
        icon: PanelLeftClose,
        shortcut: "Mod+B",
        run: () => (layout.railCollapsed = !layout.railCollapsed),
      },
      {
        id: "connection-edit-active",
        title: () => t("connections.commands.editActive"),
        group: () => t("shell.palette.groups.connection"),
        icon: Pencil,
        when: () => !!connections.active,
        run: () => connections.active && editConnection(connections.active),
      },
    );
    return untrack(() => registerCommands(commands));
  });

  // ───────────── klavye ─────────────

  async function focusEntry(index: number) {
    const entry = entries[Math.max(0, Math.min(entries.length - 1, index))];
    if (!entry) return;
    cursor = entry.key;
    await tick();
    const el = listEl?.querySelector<HTMLElement>(`[data-key="${CSS.escape(entry.key)}"]`);
    el?.focus();
    el?.scrollIntoView({ block: "nearest" });
  }

  function rowElement(key: string): HTMLElement | null {
    return listEl?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`) ?? null;
  }

  function openRowMenu(entry: Extract<Entry, { kind: "conn" }>, at?: MouseEvent) {
    const el = rowElement(entry.key);
    if (at) {
      openContextMenu(at, connectionMenu(entry.config, { x: at.clientX, y: at.clientY }));
    } else if (el) {
      openMenu(connectionMenu(entry.config, el), el);
    }
  }

  function onRowKeydown(e: KeyboardEvent, entry: Entry, index: number) {
    if (e.target !== e.currentTarget) return;
    const conn = entry.kind === "conn" ? entry : null;
    switch (e.key) {
      case "ArrowDown":
        void focusEntry(index + 1);
        break;
      case "ArrowUp":
        if (index === 0 && searchEl) searchEl.focus();
        else void focusEntry(index - 1);
        break;
      case "Home":
        void focusEntry(0);
        break;
      case "End":
        void focusEntry(entries.length - 1);
        break;
      case "Enter":
      case " ":
        if (conn) connectTo(conn.config.id);
        else if (entry.kind === "group" && !searching) toggleGroup(entry.name);
        break;
      case "ArrowRight":
        if (entry.kind === "group" && !entry.open) toggleGroup(entry.name, false);
        else if (entry.kind === "group") void focusEntry(index + 1);
        else return;
        break;
      case "ArrowLeft":
        if (entry.kind === "group" && entry.open && !searching) toggleGroup(entry.name, true);
        else if (conn?.group) void focusEntry(entries.findIndex((x) => x.key === `g:${conn.group}`));
        else return;
        break;
      case "F2":
        if (!conn) return;
        editConnection(conn.config);
        break;
      case "Delete":
        if (!conn) return;
        // Silinen satırın yerine gelen satır odak alır
        void deleteConnection(conn.config).then((deleted) => {
          if (deleted) void focusEntry(Math.min(index, entries.length - 1));
        });
        break;
      case "ContextMenu":
        if (!conn) return;
        openRowMenu(conn);
        break;
      default:
        if (e.key === "F10" && e.shiftKey && conn) {
          openRowMenu(conn);
          break;
        }
        return;
    }
    e.preventDefault();
  }

  function onSearchKeydown(e: KeyboardEvent) {
    if (e.key === "ArrowDown") void focusEntry(0);
    else if (e.key === "Enter") {
      const first = entries.find((x) => x.kind === "conn");
      if (first?.kind === "conn") connectTo(first.config.id);
    } else if (e.key === "Escape" && query) query = "";
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  // ───────────── sürükle-bırak ─────────────

  function onDragStart(e: DragEvent, c: ConnectionConfig) {
    if (searching || !e.dataTransfer) {
      e.preventDefault();
      return;
    }
    dragId = c.id;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", c.id);
  }

  function onDragOver(e: DragEvent, entry: Entry) {
    if (!dragId) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    if (entry.kind === "group") {
      drop = { key: entry.key, pos: "into" };
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    drop = { key: entry.key, pos: e.clientY < rect.top + rect.height / 2 ? "before" : "after" };
  }

  function endDrag() {
    dragId = null;
    drop = null;
  }

  async function onDrop(e: DragEvent, entry: Entry) {
    e.preventDefault();
    const id = dragId;
    const pos = drop?.pos;
    endDrag();
    if (!id || !pos) return;
    const target: DropTarget = entry.kind === "group" ? { kind: "group", group: entry.name } : { kind: pos === "before" ? "before" : "after", id: entry.config.id };
    const result = moveConnection(connections.list, id, target);
    const dragged = connections.byId(id);
    if (!result || !dragged) return;
    try {
      if (dragged.group !== result.group) await connections.save({ ...$state.snapshot(dragged), group: result.group });
      await connections.reorder(result.ids);
    } catch (err) {
      toastError(err);
    }
  }

  function onListDragLeave(e: DragEvent) {
    if (!listEl?.contains(e.relatedTarget as Node | null)) drop = null;
  }

  function newConnection() {
    ui.connectionEditor = emptyConnection();
  }
</script>

{#snippet dot(status: string, config?: ConnectionConfig)}
  {#if status !== "idle"}
    <span class="dot {status}" role="img" aria-label={statusText(status, config)} use:tooltip={statusText(status, config)}></span>
  {/if}
{/snippet}

{#if collapsed}
  <div class="rail mini">
    <div class="mini-head">
      <button class="btn ghost icon" aria-label={t("connections.newConnection")} use:tooltip={{ text: t("connections.newConnection"), shortcut: "Mod+Shift+N" }} onclick={newConnection}>
        <Plus size={16} />
      </button>
    </div>
    <div class="mini-list">
      {#each ordered as c, i (c.id)}
        {@const status = statusOf(c.id)}
        {#if i > 0 && c.group !== ordered[i - 1].group}<div class="mini-sep"></div>{/if}
        <button
          class="avatar"
          class:active={c.id === connections.activeId}
          class:tinted={!!accentColor(c)}
          style:--tone={accentColor(c) ?? "var(--text-3)"}
          aria-label={displayName(c)}
          use:tooltip={{ text: `${displayName(c)} · ${address(c)}`, shortcut: i < 9 ? `Mod+${i + 1}` : undefined }}
          onclick={() => connectTo(c.id)}
          oncontextmenu={(e) => openContextMenu(e, connectionMenu(c, { x: e.clientX, y: e.clientY }))}
        >
          {initials(c)}
          {#if status !== "idle"}<span class="avatar-dot {status}"></span>{/if}
        </button>
      {/each}
    </div>
    <div class="foot mini-foot">
      <button class="btn ghost icon" aria-label={t("connections.expand")} use:tooltip={{ text: t("connections.expand"), shortcut: "Mod+B" }} onclick={() => (layout.railCollapsed = false)}>
        <PanelLeftOpen size={16} />
      </button>
    </div>
  </div>
{:else}
  <div class="rail">
    <div class="head">
      <span class="title">{t("connections.title")}</span>
      <button class="btn ghost icon sm" aria-label={t("connections.importArdm")} use:tooltip={t("connections.importArdm")} onclick={() => (ui.importOpen = true)}>
        <Download size={15} />
      </button>
      <button class="btn ghost icon sm" aria-label={t("connections.newConnection")} use:tooltip={{ text: t("connections.newConnection"), shortcut: "Mod+Shift+N" }} onclick={newConnection}>
        <Plus size={16} />
      </button>
    </div>

    {#if showSearch}
      <div class="search">
        <Search size={13} />
        <input bind:this={searchEl} class="input sm" bind:value={query} placeholder={t("connections.search")} spellcheck="false" autocomplete="off" onkeydown={onSearchKeydown} />
        {#if query}
          <button class="clear" aria-label={t("common.clear")} onclick={() => ((query = ""), searchEl?.focus())}><X size={12} /></button>
        {/if}
      </div>
    {/if}

    <div class="list" bind:this={listEl} role="tree" tabindex="-1" aria-label={t("connections.title")} ondragleave={onListDragLeave}>
      {#if connections.list.length === 0}
        <EmptyState compact title={t("connections.empty.title")} description={t("connections.empty.text")}>
          <div class="empty-actions">
            <button class="btn sm primary" onclick={newConnection}><Plus size={14} />{t("connections.newConnection")}</button>
            <button class="btn sm" onclick={() => (ui.importOpen = true)}><Download size={14} />{t("connections.importArdm")}</button>
          </div>
        </EmptyState>
      {:else if entries.length === 0}
        <p class="no-match">{t("connections.noMatches")}</p>
      {/if}

      {#each entries as entry, index (entry.key)}
        {#if entry.kind === "group"}
          <div
            class="group"
            class:drop-into={drop?.key === entry.key}
            role="treeitem"
            aria-level={1}
            aria-expanded={entry.open}
            aria-selected={false}
            tabindex={entry.key === tabKey ? 0 : -1}
            data-key={entry.key}
            onclick={() => !searching && toggleGroup(entry.name)}
            onkeydown={(e) => onRowKeydown(e, entry, index)}
            onfocus={() => (cursor = entry.key)}
            ondragover={(e) => onDragOver(e, entry)}
            ondrop={(e) => onDrop(e, entry)}
          >
            <span class="chevron" class:open={entry.open}><ChevronRight size={12} /></span>
            <span class="group-name truncate">{entry.name}</span>
            {#if !entry.open}{@render dot(entry.status)}{/if}
            <span class="group-count tabular">{entry.count}</span>
          </div>
        {:else}
          {@const c = entry.config}
          {@const status = statusOf(c.id)}
          {@const hasName = c.name.trim() !== ""}
          <div
            class="row"
            class:active={c.id === connections.activeId}
            class:dragging={dragId === c.id}
            class:drop-before={drop?.key === entry.key && drop.pos === "before"}
            class:drop-after={drop?.key === entry.key && drop.pos === "after"}
            style:--tone={accentColor(c) ?? "transparent"}
            role="treeitem"
            aria-level={entry.group ? 2 : 1}
            aria-selected={c.id === connections.activeId}
            tabindex={entry.key === tabKey ? 0 : -1}
            data-key={entry.key}
            draggable={!searching}
            onclick={() => connectTo(c.id)}
            onkeydown={(e) => onRowKeydown(e, entry, index)}
            onfocus={() => (cursor = entry.key)}
            oncontextmenu={(e) => openRowMenu(entry, e)}
            ondragstart={(e) => onDragStart(e, c)}
            ondragover={(e) => onDragOver(e, entry)}
            ondrop={(e) => onDrop(e, entry)}
            ondragend={endDrag}
          >
            <span class="stripe"></span>
            <div class="text">
              <div class="line">
                <span class="name truncate">{displayName(c)}</span>
                {@render dot(status, c)}
              </div>
              <div class="line sub">
                <span class="addr truncate">{hasName ? address(c) : t(`connections.modes.${c.mode}`)}</span>
                <span class="icons"><ConnectionIcons config={c} size={11} /></span>
              </div>
            </div>
          </div>
        {/if}
      {/each}
    </div>

    <div class="foot">
      <button class="btn ghost icon sm" aria-label={t("connections.collapse")} use:tooltip={{ text: t("connections.collapse"), shortcut: "Mod+B" }} onclick={() => (layout.railCollapsed = true)}>
        <PanelLeftClose size={15} />
      </button>
    </div>
  </div>
{/if}

<style>
  .rail {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
  }

  /* ───── başlık ───── */
  .head {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 40px;
    flex: none;
    padding: 0 6px 0 14px;
  }

  .title {
    flex: 1;
    min-width: 0;
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-3);
  }

  .head .btn {
    color: var(--text-2);
  }

  .search {
    position: relative;
    display: flex;
    align-items: center;
    flex: none;
    margin: 0 8px 6px;
    color: var(--text-3);
  }

  .search :global(svg:first-child) {
    position: absolute;
    left: 8px;
    pointer-events: none;
  }

  .search .input {
    padding-left: 26px;
    padding-right: 24px;
    background: var(--bg-input);
  }

  .clear {
    position: absolute;
    right: 4px;
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-3);
    cursor: pointer;
  }

  .clear:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  /* ───── liste ───── */
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 6px 8px;
  }

  .no-match {
    padding: 16px 8px;
    text-align: center;
    color: var(--text-3);
    font-size: var(--fs-sm);
  }

  .empty-actions {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
  }

  .group {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 26px;
    margin-top: 6px;
    padding: 0 8px 0 4px;
    border-radius: var(--radius);
    color: var(--text-3);
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    cursor: pointer;
  }

  .group:hover {
    color: var(--text-2);
    background: var(--bg-hover);
  }

  .group:focus-visible,
  .row:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .group.drop-into {
    background: var(--bg-selected);
    color: var(--accent-text);
  }

  .chevron {
    display: grid;
    place-items: center;
    width: 14px;
    transition: transform var(--dur) var(--ease);
  }

  .chevron.open {
    transform: rotate(90deg);
  }

  .group-name {
    flex: 1;
    min-width: 0;
  }

  .group-count {
    font-weight: 500;
    letter-spacing: 0;
  }

  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 40px;
    padding: 0 8px 0 4px;
    border-radius: var(--radius);
    cursor: pointer;
  }

  .row:hover {
    background: var(--bg-hover);
  }

  .row.active {
    background: var(--bg-selected);
  }

  .row.dragging {
    opacity: 0.4;
  }

  .row.drop-before::before,
  .row.drop-after::after {
    content: "";
    position: absolute;
    left: 4px;
    right: 4px;
    height: 2px;
    border-radius: 1px;
    background: var(--accent);
    pointer-events: none;
  }

  .row.drop-before::before {
    top: -1px;
  }

  .row.drop-after::after {
    bottom: -1px;
  }

  .stripe {
    flex: none;
    align-self: stretch;
    width: 3px;
    margin: 7px 0;
    border-radius: 2px;
    background: var(--tone);
  }

  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .line {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .name {
    flex: 1;
    min-width: 0;
    font-weight: 500;
    line-height: 18px;
  }

  .row.active .name {
    color: var(--text);
  }

  .sub {
    font-size: var(--fs-xs);
    line-height: 15px;
    color: var(--text-3);
  }

  .addr {
    flex: 1;
    min-width: 0;
    font-variant-numeric: tabular-nums;
  }

  .icons {
    display: inline-flex;
    gap: 4px;
    flex: none;
  }

  .dot {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }

  .dot.connected {
    background: var(--success);
  }

  .dot.connecting {
    background: var(--warning);
    animation: pulse 1s ease-in-out infinite;
  }

  .dot.error {
    background: var(--danger);
  }

  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }

  /* ───── alt ───── */
  .foot {
    display: flex;
    align-items: center;
    height: 36px;
    flex: none;
    padding: 0 6px;
    border-top: 1px solid var(--border-subtle);
  }

  .foot .btn {
    color: var(--text-3);
  }

  .foot .btn:hover {
    color: var(--text);
  }

  /* ───── daraltılmış ───── */
  .mini {
    align-items: center;
  }

  .mini-head {
    display: grid;
    place-items: center;
    height: 44px;
    flex: none;
  }

  .mini-list {
    flex: 1;
    min-height: 0;
    width: 100%;
    overflow-y: auto;
    overflow-x: hidden;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 2px 0 8px;
    scrollbar-width: none;
  }

  .mini-sep {
    flex: none;
    width: 20px;
    height: 1px;
    margin: 2px 0;
    background: var(--border);
  }

  .avatar {
    position: relative;
    display: grid;
    place-items: center;
    flex: none;
    width: 36px;
    height: 36px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg-elevated);
    color: var(--text-2);
    font-size: var(--fs-xs);
    font-weight: 650;
    letter-spacing: 0.02em;
    cursor: pointer;
    transition:
      background var(--dur) var(--ease),
      border-color var(--dur) var(--ease);
  }

  .avatar.tinted {
    border-color: color-mix(in srgb, var(--tone) 45%, transparent);
    background: color-mix(in srgb, var(--tone) 14%, var(--bg-elevated));
    color: var(--tone);
  }

  .avatar:hover {
    border-color: var(--border-strong);
  }

  .avatar.active {
    box-shadow: 0 0 0 2px var(--bg-rail), 0 0 0 4px var(--accent);
  }

  .avatar-dot {
    position: absolute;
    right: -3px;
    bottom: -3px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 2px solid var(--bg-rail);
  }

  .avatar-dot.connected {
    background: var(--success);
  }

  .avatar-dot.connecting {
    background: var(--warning);
  }

  .avatar-dot.error {
    background: var(--danger);
  }

  .mini-foot {
    justify-content: center;
    width: 100%;
  }
</style>
