<script lang="ts">
  import Eraser from "@lucide/svelte/icons/eraser";
  import Files from "@lucide/svelte/icons/files";
  import SquareTerminal from "@lucide/svelte/icons/square-terminal";
  import { tick } from "svelte";
  import { openToolTab } from "$lib/features/shell/tools";
  import NodeSelect from "$lib/features/server/NodeSelect.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { useCommands } from "$lib/state/commands.svelte";
  import { connections } from "$lib/state/connections.svelte";
  import { toast, toastError } from "$lib/state/toasts.svelte";
  import type { Workspace } from "$lib/state/workspace.svelte";
  import { tooltip } from "$lib/ui/tooltip.svelte";
  import { copyText } from "$lib/util/clipboard";
  import ConsoleBlock from "./ConsoleBlock.svelte";
  import ConsolePrompt from "./ConsolePrompt.svelte";
  import { linesText } from "./format";
  import { requestStream } from "./pubsub.svelte";
  import { consoleSession, dropConsoleSession, type StreamRequest } from "./session.svelte";

  let { ws }: { ws: Workspace } = $props();

  const session = $derived(consoleSession(ws.connectionId, ws.db));
  const active = $derived(ws.activeTabId === "console");
  const conn = $derived(connections.byId(ws.connectionId));
  const info = $derived(connections.sessions[ws.connectionId]);

  let scroller = $state<HTMLDivElement>();
  let content = $state<HTMLDivElement>();
  let promptRef = $state<ReturnType<typeof ConsolePrompt>>();
  /** Kullanıcı yukarı kaydırmadıysa yeni çıktıda alta yapışır */
  let stick = true;

  // Sekme kapatılınca ekran durumu atılır; bağlantı değişince (bileşen yeniden kullanılır) korunur
  $effect(() => {
    const w = ws;
    return () => {
      if (!w.tabs.some((tab) => tab.id === "console")) dropConsoleSession(w.connectionId);
    };
  });

  // Yeni blok eklenince ve bloklar ölçülünce (content-visibility geç yerleşir) alta yapış
  $effect(() => {
    if (!content) return;
    const observer = new ResizeObserver(() => {
      if (stick) scrollToEnd();
    });
    observer.observe(content);
    return () => observer.disconnect();
  });

  $effect(() => {
    if (!active) return;
    void tick().then(() => {
      if (stick) scrollToEnd();
      promptRef?.focus();
    });
  });

  useCommands([
    {
      id: "console-clear",
      title: () => t("console.clear"),
      group: () => t("shell.tabs.console"),
      icon: Eraser,
      shortcut: "Mod+L",
      inInputs: true,
      when: () => ws.activeTabId === "console",
      run: () => session.clear(),
    },
  ]);

  function scrollToEnd() {
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }

  function onscroll() {
    if (!scroller) return;
    stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 24;
  }

  function run(lines: string[]) {
    stick = true;
    void session.enqueue(lines, ws);
  }

  async function copy(text: string) {
    try {
      await copyText(text);
      toast("success", t("common.copied"), { timeout: 1500 });
    } catch (err) {
      toastError(err);
    }
  }

  function copyAll() {
    const text = session.blocks.map((b) => [`db${b.db}> ${b.line}`, linesText(b.lines)].filter(Boolean).join("\n")).join("\n");
    void copy(text);
  }

  function edit(line: string) {
    session.draft = line;
    void tick().then(() => promptRef?.focus());
  }

  function openStream(request: StreamRequest) {
    requestStream(ws.connectionId, request);
    openToolTab(ws, "pubsub");
  }

  /** Boşluğa tıklayınca (metin seçmeden) komut satırına odaklan */
  function onclick(e: MouseEvent) {
    if ((e.target as HTMLElement).closest("button, a, input, select")) return;
    if (window.getSelection()?.toString()) return;
    promptRef?.focus();
  }
</script>

<div class="console">
  <div class="toolbar">
    <span class="who">
      <SquareTerminal size={14} />
      <span class="truncate">{conn?.name || conn?.host || ws.connectionId}</span>
      {#if info}<span class="muted">· Redis {info.serverVersion} · {info.mode}</span>{/if}
    </span>
    <span class="grow"></span>
    <NodeSelect connectionId={ws.connectionId} bind:value={session.node} auto />
    <button class="btn ghost icon sm" aria-label={t("console.copyAll")} use:tooltip={t("console.copyAll")} disabled={!session.blocks.length} onclick={copyAll}><Files size={14} /></button>
    <button class="btn ghost icon sm" aria-label={t("console.clear")} use:tooltip={{ text: t("console.clear"), shortcut: "Mod+L" }} disabled={!session.blocks.length} onclick={() => session.clear()}><Eraser size={14} /></button>
  </div>

  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scroll mono" bind:this={scroller} {onscroll} {onclick}>
    <div bind:this={content}>
      {#if session.blocks.length === 0}
        <div class="welcome">
          <div>{t("console.welcome", { name: conn?.name || conn?.host || "" })}</div>
          <div class="muted">{t("console.welcomeHint")}</div>
        </div>
      {/if}
      {#each session.blocks as block (block.id)}
        <ConsoleBlock
          {block}
          oncopy={copy}
          onrerun={(line) => run([line])}
          onedit={edit}
          onexpand={() => session.patch(block.id, { expanded: true })}
          onstream={openStream}
        />
      {/each}
    </div>
  </div>

  {#key session}
    <ConsolePrompt bind:this={promptRef} {session} onsubmit={(line) => run([line])} onbatch={run} oncancel={() => session.cancel()} />
  {/key}
</div>

<style>
  .console {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--bg);
    /* "=>" ve "->" redis-cli'deki gibi düz görünsün (yazı tipi bitişik harfleri kapalı) */
    font-variant-ligatures: none;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 34px;
    flex: none;
    padding: 0 8px 0 14px;
    border-bottom: 1px solid var(--border-subtle);
    font-size: var(--fs-sm);
  }

  .who {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    color: var(--text-2);
  }

  .who :global(svg) {
    flex: none;
    color: var(--text-3);
  }

  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 6px 0 10px;
    font-size: var(--fs-mono);
    cursor: text;
  }

  .welcome {
    padding: 6px 14px 10px;
    line-height: 19px;
    color: var(--text-2);
  }
</style>
