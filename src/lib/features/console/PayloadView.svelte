<script lang="ts">
  import Copy from "@lucide/svelte/icons/copy";
  import MousePointerClick from "@lucide/svelte/icons/mouse-pointer-click";
  import { isBinary, label, toBytes } from "$lib/api/bytes";
  import { t } from "$lib/i18n/index.svelte";
  import EmptyState from "$lib/ui/EmptyState.svelte";
  import Segmented from "$lib/ui/Segmented.svelte";
  import { tooltip } from "$lib/ui/tooltip.svelte";
  import { fmtBytes } from "$lib/util/format";
  import { hexDump, jsonTokens, prettyJson } from "./payload";
  import type { Entry } from "./pubsub.svelte";

  let { entry, oncopy }: { entry: Entry | undefined; oncopy: (text: string) => void } = $props();

  type Mode = "auto" | "text" | "hex";
  let mode = $state<Mode>("auto");

  /** Renklendirme bu boyutun üstünde düz metne düşer */
  const HIGHLIGHT_LIMIT = 200_000;

  const text = $derived(entry ? label(entry.payload) : "");
  const json = $derived(entry && mode === "auto" && !isBinary(entry.payload) ? prettyJson(text) : null);
  const hex = $derived(!!entry && (mode === "hex" || (mode === "auto" && isBinary(entry.payload))));
  const body = $derived.by(() => {
    if (!entry) return "";
    if (hex) return hexDump(toBytes(entry.payload));
    return json ?? text;
  });
  const tokens = $derived(json && json.length <= HIGHLIGHT_LIMIT ? jsonTokens(json) : null);
  const kindLabel = $derived(json ? "JSON" : entry && isBinary(entry.payload) ? t("console.pubsub.binary") : t("console.pubsub.text"));

  function time(ms: number): string {
    const d = new Date(ms);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}.${String(d.getMilliseconds()).padStart(3, "0")}`;
  }
</script>

<div class="viewer">
  {#if entry}
    <div class="head">
      <div class="title">
        {#if entry.source === "monitor"}
          <span class="badge mon">MONITOR</span>
          <span class="mono truncate">{entry.channel}</span>
          {#if entry.db !== null}<span class="muted">db{entry.db}</span>{/if}
        {:else}
          <span class="mono truncate strong">{entry.channel}</span>
          {#if entry.pattern}<span class="badge">{entry.pattern}</span>{/if}
        {/if}
      </div>
      <div class="sub muted tabular">{time(entry.at)} · {fmtBytes(entry.size)} · {kindLabel}</div>
    </div>
    <div class="tools">
      <Segmented
        size="sm"
        bind:value={mode}
        options={[
          { value: "auto", label: t("console.pubsub.modeAuto") },
          { value: "text", label: t("console.pubsub.modeText") },
          { value: "hex", label: "Hex" },
        ]}
      />
      <span class="grow"></span>
      <button class="btn ghost icon sm" aria-label={t("common.copy")} use:tooltip={t("common.copy")} onclick={() => oncopy(hex ? body : (json ?? text))}><Copy size={14} /></button>
    </div>
    <pre class="body mono selectable" class:nowrap={hex}>{#if tokens}{#each tokens as tok, i (i)}<span class="j-{tok.k}">{tok.s}</span>{/each}{:else}{body}{/if}</pre>
  {:else}
    <EmptyState compact icon={MousePointerClick} title={t("console.pubsub.selectTitle")} description={t("console.pubsub.selectText")} />
  {/if}
</div>

<style>
  .viewer {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
    background: var(--bg);
  }

  .head {
    padding: 10px 12px 6px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .title {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .strong {
    font-weight: 600;
  }

  .sub {
    margin-top: 2px;
    font-size: var(--fs-xs);
  }

  .badge {
    flex: none;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent-text);
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    line-height: 16px;
  }

  .badge.mon {
    background: var(--warning-soft);
    color: var(--warning);
    font-family: var(--font-ui);
    font-weight: 700;
    letter-spacing: 0.03em;
  }

  .tools {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px 6px 12px;
  }

  .body {
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: 4px 12px 12px;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    line-height: 1.55;
  }

  .body.nowrap {
    white-space: pre;
    overflow-wrap: normal;
  }

  .j-key {
    color: var(--type-hash);
  }

  .j-str {
    color: var(--type-list);
  }

  .j-num,
  .j-lit {
    color: var(--type-string);
  }

  .j-punct {
    color: var(--text-2);
  }
</style>
