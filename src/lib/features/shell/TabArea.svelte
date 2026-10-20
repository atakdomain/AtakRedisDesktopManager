<script lang="ts">
  import Gauge from "@lucide/svelte/icons/gauge";
  import Layers from "@lucide/svelte/icons/layers";
  import Plus from "@lucide/svelte/icons/plus";
  import Radio from "@lucide/svelte/icons/radio";
  import Server from "@lucide/svelte/icons/server";
  import SquareTerminal from "@lucide/svelte/icons/square-terminal";
  import X from "@lucide/svelte/icons/x";
  import MousePointerClick from "@lucide/svelte/icons/mouse-pointer-click";
  import { bytesId } from "$lib/api/bytes";
  import BulkTab from "$lib/features/bulk/BulkTab.svelte";
  import ConsoleTab from "$lib/features/console/ConsoleTab.svelte";
  import PubSubTab from "$lib/features/console/PubSubTab.svelte";
  import KeyEditor from "$lib/features/editors/KeyEditor.svelte";
  import ServerTab from "$lib/features/server/ServerTab.svelte";
  import SlowlogTab from "$lib/features/server/SlowlogTab.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { openContextMenu, openMenu, type MenuItem } from "$lib/state/menu.svelte";
  import type { Tab, TabKind, Workspace } from "$lib/state/workspace.svelte";
  import EmptyState from "$lib/ui/EmptyState.svelte";
  import Kbd from "$lib/ui/Kbd.svelte";
  import TypeBadge from "$lib/ui/TypeBadge.svelte";
  import { tooltip } from "$lib/ui/tooltip.svelte";
  import { openToolTab } from "./tools";

  let { ws }: { ws: Workspace } = $props();

  const kindIcons = { server: Server, console: SquareTerminal, slowlog: Gauge, pubsub: Radio, bulk: Layers } as const;

  function keyType(tab: Tab) {
    return tab.key ? (ws.metaOf(bytesId(tab.key))?.type ?? tab.keyType) : undefined;
  }

  function tabMenu(e: MouseEvent, tab: Tab) {
    const index = ws.tabs.indexOf(tab);
    const items: MenuItem[] = [
      { label: t("shell.tabs.close"), shortcut: "Mod+W", run: () => ws.closeTab(tab.id) },
      { label: t("shell.tabs.closeOthers"), disabled: ws.tabs.length < 2, run: () => ws.closeTabs((x) => x.id !== tab.id) },
      { label: t("shell.tabs.closeRight"), disabled: index === ws.tabs.length - 1, run: () => ws.closeTabs((x) => ws.tabs.indexOf(x) > index) },
      { label: t("shell.tabs.closeAll"), run: () => ws.closeTabs(() => true) },
    ];
    if (tab.preview) items.push({ kind: "separator" }, { label: t("shell.tabs.keepOpen"), run: () => ws.pinTab(tab.id) });
    openContextMenu(e, items);
  }

  function addMenu(e: MouseEvent) {
    const tools: { kind: Exclude<TabKind, "key" | "bulk">; label: string; shortcut?: string }[] = [
      { kind: "console", label: t("shell.tabs.console"), shortcut: "Mod+`" },
      { kind: "server", label: t("shell.tabs.server") },
      { kind: "slowlog", label: t("shell.tabs.slowlog") },
      { kind: "pubsub", label: t("shell.tabs.pubsub") },
    ];
    openMenu(
      tools.map((tool) => ({ label: tool.label, icon: kindIcons[tool.kind], shortcut: tool.shortcut, run: () => openToolTab(ws, tool.kind) })),
      e.currentTarget as HTMLElement,
      { align: "end" },
    );
  }
</script>

<section class="area">
  <div class="bar" role="tablist">
    <div class="tabs">
      {#each ws.tabs as tab (tab.id)}
        {@const active = tab.id === ws.activeTabId}
        <div
          class="tab"
          class:active
          class:preview={tab.preview}
          role="tab"
          tabindex="0"
          aria-selected={active}
          onclick={() => (ws.activeTabId = tab.id)}
          ondblclick={() => ws.pinTab(tab.id)}
          onauxclick={(e) => e.button === 1 && ws.closeTab(tab.id)}
          onkeydown={(e) => e.key === "Enter" && (ws.activeTabId = tab.id)}
          oncontextmenu={(e) => tabMenu(e, tab)}
          use:tooltip={tab.kind === "key" ? tab.title : undefined}
        >
          {#if tab.kind === "key"}
            <TypeBadge type={keyType(tab)} compact />
          {:else}
            {@const Icon = kindIcons[tab.kind]}
            <span class="kind-icon"><Icon size={14} /></span>
          {/if}
          <span class="title">{tab.title}</span>
          <button
            class="close"
            class:dirty={tab.dirty}
            aria-label={t("shell.tabs.close")}
            onclick={(e) => {
              e.stopPropagation();
              ws.closeTab(tab.id);
            }}><X size={13} /></button
          >
        </div>
      {/each}
    </div>
    <button class="btn ghost icon sm add" aria-label={t("shell.tabs.openMenu")} use:tooltip={t("shell.tabs.openMenu")} onclick={addMenu}><Plus size={15} /></button>
  </div>

  <div class="content">
    {#each ws.tabs as tab (tab.id)}
      {@const active = tab.id === ws.activeTabId}
      {#if tab.kind === "key"}
        {#if active}<div class="pane"><KeyEditor {ws} {tab} /></div>{/if}
      {:else}
        <div class="pane" hidden={!active}>
          {#if tab.kind === "server"}<ServerTab {ws} />
          {:else if tab.kind === "console"}<ConsoleTab {ws} />
          {:else if tab.kind === "slowlog"}<SlowlogTab {ws} />
          {:else if tab.kind === "pubsub"}<PubSubTab {ws} />
          {:else if tab.kind === "bulk"}<BulkTab {ws} {tab} />
          {/if}
        </div>
      {/if}
    {:else}
      <EmptyState icon={MousePointerClick} title={t("shell.tabs.emptyTitle")} description={t("shell.tabs.emptyText")}>
        <div class="hints">
          <span><Kbd shortcut="Mod+K" /> {t("shell.commands.palette")}</span>
          <span><Kbd shortcut="Mod+P" /> {t("shell.commands.quickOpen")}</span>
          <span><Kbd shortcut="Mod+`" /> {t("shell.commands.openConsole")}</span>
        </div>
      </EmptyState>
    {/each}
  </div>
</section>

<style>
  .area {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    background: var(--bg);
  }

  .bar {
    display: flex;
    align-items: stretch;
    height: 36px;
    flex: none;
    border-bottom: 1px solid var(--border);
    background: var(--bg-sunken);
  }

  .tabs {
    display: flex;
    flex: 1;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .tabs::-webkit-scrollbar {
    display: none;
  }

  .tab {
    position: relative;
    display: flex;
    align-items: center;
    gap: 7px;
    max-width: 240px;
    min-width: 0;
    flex: none;
    padding: 0 6px 0 10px;
    border-right: 1px solid var(--border-subtle);
    color: var(--text-2);
    font-size: var(--fs-sm);
    cursor: pointer;
  }

  .tab:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .tab.active {
    background: var(--bg);
    color: var(--text);
  }

  .tab.active::before {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    height: 2px;
    background: var(--accent);
  }

  .tab.active::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    bottom: -1px;
    height: 1px;
    background: var(--bg);
  }

  .preview .title {
    font-style: italic;
  }

  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .kind-icon {
    display: grid;
    color: var(--text-3);
  }

  .close {
    display: grid;
    place-items: center;
    flex: none;
    width: 20px;
    height: 20px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-3);
    cursor: pointer;
    opacity: 0;
  }

  .tab:hover .close,
  .tab.active .close {
    opacity: 1;
  }

  .close:hover {
    background: var(--bg-active);
    color: var(--text);
  }

  .close.dirty {
    opacity: 1;
  }

  .close.dirty :global(svg) {
    display: none;
  }

  .close.dirty::after {
    content: "";
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-2);
  }

  .close.dirty:hover::after {
    display: none;
  }

  .close.dirty:hover :global(svg) {
    display: block;
  }

  .add {
    align-self: center;
    margin: 0 6px;
    flex: none;
  }

  .content {
    position: relative;
    flex: 1;
    min-height: 0;
  }

  .pane {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
  }

  .pane[hidden] {
    display: none;
  }

  .hints {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 8px;
    color: var(--text-3);
    font-size: var(--fs-sm);
  }

  .hints span {
    display: flex;
    align-items: center;
    gap: 8px;
  }
</style>
