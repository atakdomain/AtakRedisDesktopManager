<script lang="ts">
  // Ctrl+K: komutlar · Ctrl+P: yüklenen anahtarlara hızlı git
  import KeyRound from "@lucide/svelte/icons/key-round";
  import { bytesId, label } from "$lib/api/bytes";
  import type { RBytes } from "$lib/api/types";
  import { t } from "$lib/i18n/index.svelte";
  import { allCommands, palette, type Command } from "$lib/state/commands.svelte";
  import { connections } from "$lib/state/connections.svelte";
  import { workspaceFor } from "$lib/state/workspace.svelte";
  import Kbd from "$lib/ui/Kbd.svelte";
  import TypeBadge from "$lib/ui/TypeBadge.svelte";
  import { foldCase } from "$lib/util/match";

  let { mode }: { mode: "commands" | "keys" } = $props();

  let input = $state<HTMLInputElement>();
  let list = $state<HTMLDivElement>();
  let active = $state(0);

  type Entry = { kind: "command"; command: Command; score: number } | { kind: "key"; key: RBytes; text: string; score: number };

  /** Alt dizi eşleşmesi; ardışık ve sözcük başı eşleşmeler daha yüksek puan alır */
  function score(text: string, query: string): number {
    if (!query) return 1;
    const hay = foldCase(text);
    const needle = foldCase(query);
    const direct = hay.indexOf(needle);
    if (direct >= 0) return 1000 - direct + (direct === 0 ? 500 : 0);
    let pos = 0;
    let total = 0;
    let streak = 0;
    for (const ch of needle) {
      const found = hay.indexOf(ch, pos);
      if (found < 0) return 0;
      streak = found === pos ? streak + 1 : 0;
      total += 1 + streak * 2 + (found === 0 || /[\s:._\-/]/.test(hay[found - 1]) ? 3 : 0);
      pos = found + 1;
    }
    return total;
  }

  const ws = $derived(connections.activeId && connections.status[connections.activeId] === "connected" ? workspaceFor(connections.activeId) : null);

  const entries = $derived.by((): Entry[] => {
    const query = palette.query.trim();
    if (mode === "commands") {
      return allCommands()
        .map((command) => ({ kind: "command" as const, command, score: score(`${command.title()} ${command.group?.() ?? ""}`, query) }))
        .filter((e) => e.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 60);
    }
    if (!ws) return [];
    const out: Entry[] = [];
    for (const key of ws.keyList) {
      const text = label(key);
      const s = score(text, query);
      if (s > 0) out.push({ kind: "key", key, text, score: s });
      if (!query && out.length >= 200) break;
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 200);
  });

  $effect(() => {
    void palette.query;
    active = 0;
  });

  $effect(() => {
    input?.focus();
  });

  function close() {
    palette.open = false;
    palette.query = "";
  }

  function run(entry: Entry | undefined) {
    if (!entry) return;
    close();
    if (entry.kind === "command") void entry.command.run();
    else ws?.openKey(entry.key, false);
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "ArrowDown") active = Math.min(entries.length - 1, active + 1);
    else if (e.key === "ArrowUp") active = Math.max(0, active - 1);
    else if (e.key === "Enter") run(entries[active]);
    else if (e.key === "Escape") close();
    else return;
    e.preventDefault();
    e.stopPropagation();
    list?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }
</script>

<div class="scrim" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && close()}>
  <div class="palette" role="dialog" aria-label={t("common.commandPalette")}>
    <input
      bind:this={input}
      class="query"
      bind:value={palette.query}
      placeholder={mode === "commands" ? t("shell.palette.placeholder") : t("shell.palette.keyPlaceholder")}
      spellcheck="false"
      autocomplete="off"
      {onkeydown}
    />
    <div class="list" bind:this={list} role="listbox">
      {#each entries as entry, i (entry.kind === "command" ? entry.command.id : bytesId(entry.key))}
        <button class="entry" class:active={i === active} data-index={i} role="option" aria-selected={i === active} onpointermove={() => (active = i)} onclick={() => run(entry)}>
          {#if entry.kind === "command"}
            <span class="icon">{#if entry.command.icon}<entry.command.icon size={15} />{/if}</span>
            <span class="text truncate">{entry.command.title()}</span>
            {#if entry.command.group}<span class="group">{entry.command.group()}</span>{/if}
            {#if entry.command.shortcut}<Kbd shortcut={entry.command.shortcut} subtle />{/if}
          {:else}
            {@const meta = ws?.metaOf(bytesId(entry.key))}
            <span class="icon"><KeyRound size={14} /></span>
            <span class="text truncate mono">{entry.text}</span>
            <TypeBadge type={meta?.type} />
          {/if}
        </button>
      {:else}
        <div class="none">{t("shell.palette.noMatch")}</div>
      {/each}
    </div>
    <div class="foot">{t("shell.palette.hint")}</div>
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 12vh;
    background: color-mix(in srgb, var(--scrim) 50%, transparent);
  }

  .palette {
    display: flex;
    flex-direction: column;
    width: min(620px, calc(100vw - 32px));
    max-height: 62vh;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
    animation: drop 120ms var(--ease);
  }

  @keyframes drop {
    from {
      opacity: 0;
      transform: translateY(-6px);
    }
  }

  .query {
    height: 46px;
    padding: 0 16px;
    border: 0;
    border-bottom: 1px solid var(--border);
    background: transparent;
    font-size: var(--fs-md);
    outline: none;
  }

  .list {
    flex: 1;
    overflow-y: auto;
    padding: 6px;
  }

  .entry {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 32px;
    padding: 0 10px;
    border: 0;
    border-radius: var(--radius);
    background: none;
    text-align: left;
    cursor: pointer;
  }

  .entry.active {
    background: var(--bg-selected);
  }

  .icon {
    display: grid;
    place-items: center;
    width: 16px;
    color: var(--text-3);
  }

  .text {
    flex: 1;
  }

  .group {
    font-size: var(--fs-xs);
    color: var(--text-3);
  }

  .none {
    padding: 20px;
    text-align: center;
    color: var(--text-3);
  }

  .foot {
    padding: 6px 14px;
    border-top: 1px solid var(--border-subtle);
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
</style>
