<script lang="ts">
  // Kanal / desen fişleri. Enter veya virgül ekler, boşken Backspace sonuncuyu siler,
  // fişe tıklamak kanal ↔ desen arasında geçiş yapar. Boş kutuda Enter → `onsubmit`.
  import Asterisk from "@lucide/svelte/icons/asterisk";
  import Hash from "@lucide/svelte/icons/hash";
  import X from "@lucide/svelte/icons/x";
  import { t } from "$lib/i18n/index.svelte";
  import { tooltip } from "$lib/ui/tooltip.svelte";
  import type { Target } from "./pubsub.svelte";

  interface Props {
    targets: Target[];
    onadd: (texts: string[]) => void;
    onremove: (index: number) => void;
    ontoggle: (index: number) => void;
    onsubmit: () => void;
  }

  let { targets, onadd, onremove, ontoggle, onsubmit }: Props = $props();

  let text = $state("");
  let input = $state<HTMLInputElement>();

  function commit(): boolean {
    const parts = text.split(/[,\s]+/).filter(Boolean);
    text = "";
    if (!parts.length) return false;
    onadd(parts);
    return true;
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!commit()) onsubmit();
    } else if (e.key === "," || (e.key === " " && text.trim())) {
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && !text && targets.length) {
      e.preventDefault();
      onremove(targets.length - 1);
    }
  }

  function onpaste(e: ClipboardEvent) {
    const pasted = e.clipboardData?.getData("text/plain") ?? "";
    if (!/[,\s]/.test(pasted.trim())) return;
    e.preventDefault();
    text += pasted;
    commit();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="chips" onclick={() => input?.focus()}>
  {#each targets as target, i (target.text)}
    <span class="chip" class:pattern={target.pattern}>
      <button class="kind" aria-label={t("console.pubsub.toggleKind")} use:tooltip={target.pattern ? t("console.pubsub.isPattern") : t("console.pubsub.isChannel")} onclick={() => ontoggle(i)}>
        {#if target.pattern}<Asterisk size={11} />{:else}<Hash size={11} />{/if}
      </button>
      <span class="text mono">{target.text}</span>
      <button class="remove" aria-label={t("common.delete")} onclick={() => onremove(i)}><X size={11} /></button>
    </span>
  {/each}
  <input
    bind:this={input}
    bind:value={text}
    class="mono"
    placeholder={targets.length ? "" : t("console.pubsub.targetsPlaceholder")}
    spellcheck="false"
    autocomplete="off"
    aria-label={t("console.pubsub.targets")}
    {onkeydown}
    {onpaste}
    onblur={commit}
  />
</div>

<style>
  .chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    flex: 1;
    min-width: 0;
    min-height: var(--h-control);
    padding: 2px 4px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--bg-input);
    cursor: text;
    transition:
      border-color var(--dur) var(--ease),
      box-shadow var(--dur) var(--ease);
  }

  .chips:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    max-width: 260px;
    height: 20px;
    padding: 0 2px;
    border-radius: var(--radius-sm);
    background: var(--bg-active);
    color: var(--text);
  }

  .chip.pattern {
    background: var(--accent-soft);
    color: var(--accent-text);
  }

  .text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--fs-xs);
  }

  .kind,
  .remove {
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    padding: 0;
    border: 0;
    border-radius: 3px;
    background: none;
    color: inherit;
    opacity: 0.7;
    cursor: pointer;
  }

  .kind:hover,
  .remove:hover {
    opacity: 1;
    background: var(--bg-active);
  }

  input {
    flex: 1;
    min-width: 120px;
    height: 22px;
    padding: 0 4px;
    border: 0;
    background: none;
    outline: none;
    font-size: var(--fs-mono);
  }

  input::placeholder {
    color: var(--text-3);
    font-family: var(--font-ui);
    font-size: var(--fs-sm);
  }
</style>
