<script lang="ts">
  import Command from "@lucide/svelte/icons/command";
  import Download from "@lucide/svelte/icons/download";
  import Keyboard from "@lucide/svelte/icons/keyboard";
  import Plus from "@lucide/svelte/icons/plus";
  import SunMoon from "@lucide/svelte/icons/sun-moon";
  import SquareTerminal from "@lucide/svelte/icons/square-terminal";
  import Server from "@lucide/svelte/icons/server";
  import Gauge from "@lucide/svelte/icons/gauge";
  import Radio from "@lucide/svelte/icons/radio";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Unplug from "@lucide/svelte/icons/unplug";
  import Settings from "@lucide/svelte/icons/settings";
  import KeyRound from "@lucide/svelte/icons/key-round";
  import { onMount, untrack } from "svelte";
  import KeyBrowser from "$lib/features/browser/KeyBrowser.svelte";
  import ConnectionEditor from "$lib/features/connections/ConnectionEditor.svelte";
  import ConnectionRail from "$lib/features/connections/ConnectionRail.svelte";
  import ConnectionStatusView from "$lib/features/connections/ConnectionStatusView.svelte";
  import Home from "$lib/features/onboarding/Home.svelte";
  import ImportWizard from "$lib/features/onboarding/ImportWizard.svelte";
  import SettingsDialog from "$lib/features/settings/SettingsDialog.svelte";
  import CommandPalette from "$lib/features/shell/CommandPalette.svelte";
  import ShortcutsDialog from "$lib/features/shell/ShortcutsDialog.svelte";
  import StatusBar from "$lib/features/shell/StatusBar.svelte";
  import TabArea from "$lib/features/shell/TabArea.svelte";
  import { openToolTab } from "$lib/features/shell/tools";
  import { t } from "$lib/i18n/index.svelte";
  import { handleShortcut, palette, useCommands } from "$lib/state/commands.svelte";
  import { connections, emptyConnection } from "$lib/state/connections.svelte";
  import { loadSettings, resolvedTheme, settings, trackSettings } from "$lib/state/settings.svelte";
  import { toastError } from "$lib/state/toasts.svelte";
  import { layout, LAYOUT_DEFAULTS, loadLayout, trackLayout, ui } from "$lib/state/ui.svelte";
  import { workspaceFor } from "$lib/state/workspace.svelte";
  import DialogHost from "$lib/ui/DialogHost.svelte";
  import MenuHost from "$lib/ui/MenuHost.svelte";
  import Resizer from "$lib/ui/Resizer.svelte";
  import Toaster from "$lib/ui/Toaster.svelte";
  import TooltipHost from "$lib/ui/TooltipHost.svelte";

  let { onready }: { onready: () => void } = $props();

  let ready = $state(false);

  trackSettings();
  trackLayout();

  onMount(async () => {
    try {
      await Promise.all([loadSettings(), loadLayout(), connections.load()]);
    } catch (err) {
      toastError(err);
    }
    ready = true;
    onready();
    // İlk açılış: hiç bağlantı yoksa ARDM'den aktarma sihirbazı
    if (!settings.onboardingDone && connections.list.length === 0) ui.importOpen = true;
  });

  const activeId = $derived(connections.activeId);
  const status = $derived(activeId ? (connections.status[activeId] ?? "idle") : "idle");
  const ws = $derived(activeId && status === "connected" ? workspaceFor(activeId) : null);

  $effect(() => {
    const current = ws;
    if (current) untrack(() => void current.init());
  });

  const hasWs = () => ws !== null;

  useCommands([
    { id: "palette", title: () => t("shell.commands.palette"), icon: Command, shortcut: "Mod+K", inInputs: true, hidden: true, run: () => openPalette("commands") },
    { id: "palette-alt", title: () => t("shell.commands.palette"), shortcut: "Mod+Shift+P", inInputs: true, hidden: true, run: () => openPalette("commands") },
    { id: "quick-open", title: () => t("shell.commands.quickOpen"), icon: KeyRound, shortcut: "Mod+P", inInputs: true, when: hasWs, run: () => openPalette("keys") },
    { id: "new-connection", title: () => t("shell.commands.newConnection"), group: () => t("shell.palette.groups.connection"), icon: Plus, shortcut: "Mod+Shift+N", run: () => (ui.connectionEditor = emptyConnection()) },
    { id: "import-ardm", title: () => t("shell.commands.importArdm"), group: () => t("shell.palette.groups.connection"), icon: Download, run: () => (ui.importOpen = true) },
    { id: "settings", title: () => t("shell.commands.settings"), group: () => t("shell.palette.groups.general"), icon: Settings, shortcut: "Mod+,", run: () => (ui.settingsOpen = true) },
    { id: "shortcuts", title: () => t("shell.commands.shortcuts"), group: () => t("shell.palette.groups.general"), icon: Keyboard, shortcut: "Mod+/", run: () => (ui.shortcutsOpen = true) },
    { id: "theme", title: () => t("shell.commands.toggleTheme"), group: () => t("shell.palette.groups.view"), icon: SunMoon, run: () => (settings.theme = resolvedTheme() === "dark" ? "light" : "dark") },
    { id: "console", title: () => t("shell.commands.openConsole"), group: () => t("shell.palette.groups.connection"), icon: SquareTerminal, shortcut: "Mod+`", inInputs: true, when: hasWs, run: () => ws && openToolTab(ws, "console") },
    { id: "server", title: () => t("shell.commands.openServer"), group: () => t("shell.palette.groups.connection"), icon: Server, when: hasWs, run: () => ws && openToolTab(ws, "server") },
    { id: "slowlog", title: () => t("shell.commands.openSlowlog"), group: () => t("shell.palette.groups.connection"), icon: Gauge, when: hasWs, run: () => ws && openToolTab(ws, "slowlog") },
    { id: "pubsub", title: () => t("shell.commands.openPubsub"), group: () => t("shell.palette.groups.connection"), icon: Radio, when: hasWs, run: () => ws && openToolTab(ws, "pubsub") },
    { id: "close-tab", title: () => t("shell.commands.closeTab"), shortcut: "Mod+W", inInputs: true, when: () => !!ws?.activeTabId, run: () => ws?.activeTabId && ws.closeTab(ws.activeTabId) },
    { id: "next-tab", title: () => t("shell.commands.nextTab"), shortcut: "Mod+Tab", inInputs: true, hidden: true, when: hasWs, run: () => cycleTab(1) },
    { id: "prev-tab", title: () => t("shell.commands.prevTab"), shortcut: "Mod+Shift+Tab", inInputs: true, hidden: true, when: hasWs, run: () => cycleTab(-1) },
    { id: "reconnect", title: () => t("shell.commands.reconnect"), group: () => t("shell.palette.groups.connection"), icon: RefreshCw, when: () => !!activeId, run: () => activeId && connections.connect(activeId, true) },
    { id: "disconnect", title: () => t("shell.commands.disconnect"), group: () => t("shell.palette.groups.connection"), icon: Unplug, when: () => status === "connected", run: () => activeId && connections.disconnect(activeId) },
  ]);

  function openPalette(mode: "commands" | "keys") {
    palette.mode = mode;
    palette.query = "";
    palette.open = true;
  }

  function cycleTab(delta: number) {
    if (!ws || ws.tabs.length === 0) return;
    const index = ws.tabs.findIndex((tab) => tab.id === ws.activeTabId);
    ws.activeTabId = ws.tabs[(index + delta + ws.tabs.length) % ws.tabs.length].id;
  }

  /** WebView'ın tarayıcı kısayolları (yenile, yazdır, bul…) uygulamayı bozmasın */
  const BROWSER_COMBOS = new Set(["F5", "Mod+R", "Mod+Shift+R", "Mod+P", "Mod+F", "Mod+G", "Mod+J", "Mod+U", "Mod+S", "Mod+O", "Mod+H", "Mod+N", "Mod+T", "F3", "F7", "Mod+Shift+I"]);

  function onkeydown(e: KeyboardEvent) {
    handleShortcut(e);
    if (e.defaultPrevented) return;
    const mod = e.ctrlKey || e.metaKey;
    const combo = `${mod ? "Mod+" : ""}${e.shiftKey ? "Shift+" : ""}${e.key.length === 1 ? e.key.toUpperCase() : e.key}`;
    if (BROWSER_COMBOS.has(combo) && !(import.meta.env.DEV && combo === "Mod+Shift+I")) e.preventDefault();
  }

  function oncontextmenu(e: MouseEvent) {
    // Yerel bağlam menüsü yalnızca metin alanlarında
    const target = e.target as HTMLElement;
    if (!target.closest("input, textarea, .cm-editor, .selectable")) e.preventDefault();
  }
</script>

<svelte:window {onkeydown} {oncontextmenu} />

{#if ready}
  <div class="app">
    <div class="main">
      {#if !layout.railCollapsed}
        <div class="rail" style:width="{layout.railWidth}px"><ConnectionRail /></div>
        <Resizer bind:width={layout.railWidth} min={180} max={420} initial={LAYOUT_DEFAULTS.railWidth} />
      {:else}
        <div class="rail collapsed"><ConnectionRail /></div>
      {/if}

      {#if ws}
        <div class="browser" style:width="{layout.browserWidth}px"><KeyBrowser {ws} /></div>
        <Resizer bind:width={layout.browserWidth} min={260} max={760} initial={LAYOUT_DEFAULTS.browserWidth} />
        <TabArea {ws} />
      {:else if activeId}
        <div class="fill"><ConnectionStatusView connectionId={activeId} /></div>
      {:else}
        <div class="fill"><Home /></div>
      {/if}
    </div>
    <StatusBar />
  </div>

  {#if ui.connectionEditor}<ConnectionEditor />{/if}
  {#if ui.importOpen}<ImportWizard />{/if}
  {#if ui.settingsOpen}<SettingsDialog />{/if}
  {#if ui.shortcutsOpen}<ShortcutsDialog />{/if}
  {#if palette.open}<CommandPalette mode={palette.mode} />{/if}
{/if}

<MenuHost />
<TooltipHost />
<Toaster />
<DialogHost />

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .main {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  .rail {
    flex: none;
    min-width: 0;
    background: var(--bg-rail);
  }

  .rail.collapsed {
    width: 56px;
    border-right: 1px solid var(--border);
  }

  .browser {
    flex: none;
    min-width: 0;
    background: var(--bg-sunken);
  }

  .fill {
    flex: 1;
    min-width: 0;
  }
</style>
