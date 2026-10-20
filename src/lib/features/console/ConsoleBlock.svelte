<script lang="ts">
  import Copy from "@lucide/svelte/icons/copy";
  import Files from "@lucide/svelte/icons/files";
  import Lock from "@lucide/svelte/icons/lock";
  import PencilLine from "@lucide/svelte/icons/pencil-line";
  import Radio from "@lucide/svelte/icons/radio";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import { t } from "$lib/i18n/index.svelte";
  import Spinner from "$lib/ui/Spinner.svelte";
  import VirtualList from "$lib/ui/VirtualList.svelte";
  import { tooltip } from "$lib/ui/tooltip.svelte";
  import { fmtDuration } from "$lib/util/format";
  import { linesText, type FLine } from "./format";
  import type { Block, StreamRequest } from "./session.svelte";

  interface Props {
    block: Block;
    oncopy: (text: string) => void;
    onrerun: (line: string) => void;
    onedit: (line: string) => void;
    onexpand: () => void;
    onstream: (request: StreamRequest) => void;
  }

  let { block, oncopy, onrerun, onedit, onexpand, onstream }: Props = $props();

  /** Bu kadar satırdan uzun çıktılar önce kısaltılır; "tümünü göster" sanal listeye geçer */
  const PREVIEW = 500;
  /** Sanal listede satır yüksekliği (CSS'teki line-height ile aynı) */
  const ROW = 19;

  const big = $derived(block.lines.length > PREVIEW);
  const shown = $derived(big ? block.lines.slice(0, PREVIEW) : block.lines);
  const nameEnd = $derived(block.line.search(/\s|$/));
  const prompt = $derived(`${block.node ? `${block.node} ` : ""}db${block.db}>`);
</script>

{#snippet lineRow(line: FLine)}
  <div class="ln">{#if line.p}<span class="p">{line.p}</span>{/if}<span class="v">{#each line.segs as seg, j (j)}<span class="k-{seg.k}">{seg.s}</span>{/each}</span></div>
{/snippet}

<div class="block {block.kind}" class:queued={block.state === "queued"} class:cancelled={block.state === "cancelled"}>
  <div class="head">
    <span class="ps">{prompt}</span>
    <span class="cmd selectable"><span class="name">{block.line.slice(0, nameEnd)}</span>{block.line.slice(nameEnd)}</span>
    <span class="meta tabular">
      {#if block.state === "running"}
        <Spinner size={11} />
      {:else if block.state === "queued"}
        {t("console.queued")}
      {:else if block.elapsedMs !== null}
        {fmtDuration(block.elapsedMs)}
      {/if}
    </span>
    <span class="actions">
      <button class="act" aria-label={t("console.copyCommand")} use:tooltip={t("console.copyCommand")} onclick={() => oncopy(block.line)}><Copy size={13} /></button>
      {#if block.lines.length}
        <button class="act" aria-label={t("console.copyOutput")} use:tooltip={t("console.copyOutput")} onclick={() => oncopy(linesText(block.lines))}><Files size={13} /></button>
      {/if}
      <button class="act" aria-label={t("console.edit")} use:tooltip={t("console.edit")} onclick={() => onedit(block.line)}><PencilLine size={13} /></button>
      <button class="act" aria-label={t("console.rerun")} use:tooltip={t("console.rerun")} onclick={() => onrerun(block.line)}><RotateCcw size={13} /></button>
    </span>
  </div>

  {#if block.kind === "readOnly"}
    <div class="note warn"><Lock size={13} /><span>{t("console.readOnly")}</span></div>
  {:else if block.kind === "failed"}
    <div class="out selectable"><div class="ln"><span class="v k-err">{block.message}</span></div></div>
  {:else if block.kind === "declined" && block.message}
    <div class="note muted-note">{block.message}</div>
  {:else if block.kind === "stream" && block.stream}
    {@const stream = block.stream}
    <div class="note info">
      <Radio size={13} />
      <span>{stream.monitor ? t("console.streamMonitor") : t("console.streamPubsub")}</span>
      <button class="btn sm" onclick={() => onstream(stream)}>{t("console.openPubsub")}</button>
    </div>
  {:else if block.lines.length}
    <div class="out selectable">
      {#if big && block.expanded}
        <div class="virtual" style:height="{Math.min(block.lines.length * ROW, 560)}px">
          <VirtualList count={block.lines.length} rowHeight={ROW} overscan={20}>
            {#snippet row(i)}{@render lineRow(block.lines[i])}{/snippet}
          </VirtualList>
        </div>
      {:else}
        {#each shown as line, i (i)}{@render lineRow(line)}{/each}
      {/if}
    </div>
    {#if big}
      <div class="more">
        {#if !block.expanded}
          <span>{t("console.moreLines", { count: block.lines.length - PREVIEW })}</span>
          <button class="link" onclick={onexpand}>{t("console.showAll", { count: block.lines.length })}</button>
        {:else}
          <span>{t("console.lineCount", { count: block.lines.length })}</span>
        {/if}
        <button class="link" onclick={() => oncopy(linesText(block.lines))}>{t("console.copyOutput")}</button>
      </div>
    {/if}
  {/if}
</div>

<style>
  .block {
    padding: 3px 14px 5px;
    content-visibility: auto;
    contain-intrinsic-size: auto 44px;
  }

  .block:hover {
    background: var(--bg-hover);
  }

  .head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-height: 20px;
    line-height: 19px;
  }

  .ps {
    flex: none;
    color: var(--accent-text);
    font-weight: 600;
    opacity: 0.85;
  }

  .cmd {
    min-width: 0;
    flex: 1;
    color: var(--text);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .name {
    font-weight: 600;
  }

  .queued .cmd,
  .cancelled .cmd {
    color: var(--text-3);
  }

  .meta {
    flex: none;
    display: inline-flex;
    align-items: center;
    color: var(--text-3);
    font-size: var(--fs-xs);
    font-family: var(--font-ui);
  }

  .actions {
    flex: none;
    display: inline-flex;
    gap: 1px;
    align-self: center;
    opacity: 0;
    transition: opacity var(--dur) var(--ease);
  }

  .block:hover .actions,
  .actions:focus-within {
    opacity: 1;
  }

  .act {
    display: grid;
    place-items: center;
    width: 22px;
    height: 20px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-3);
    cursor: pointer;
  }

  .act:hover {
    background: var(--bg-active);
    color: var(--text);
  }

  .out {
    line-height: 19px;
  }

  .ln {
    display: flex;
    min-height: 19px;
  }

  .p {
    flex: none;
    white-space: pre;
    color: var(--text-3);
  }

  .v {
    min-width: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .virtual {
    margin-top: 2px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius);
    background: var(--bg-sunken);
  }

  .virtual .ln {
    padding: 0 8px;
  }

  .virtual .v {
    white-space: pre;
  }

  .k-str {
    color: var(--type-list);
  }

  .k-int,
  .k-dbl,
  .k-big,
  .k-bool {
    color: var(--type-hash);
  }

  .k-nil,
  .k-empty,
  .k-sep,
  .k-idx {
    color: var(--text-3);
  }

  .k-err {
    color: var(--danger);
  }

  .k-status,
  .k-verbatim {
    color: var(--text);
  }

  .note {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 2px 0 1px;
    font-family: var(--font-ui);
    font-size: var(--fs-sm);
    line-height: 1.4;
  }

  .note :global(svg) {
    flex: none;
  }

  .warn {
    color: var(--warning);
  }

  .info {
    color: var(--accent-text);
  }

  .muted-note {
    color: var(--text-3);
    font-style: italic;
  }

  .more {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 4px;
    font-family: var(--font-ui);
    font-size: var(--fs-xs);
    color: var(--text-3);
  }

  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent-text);
    font-size: inherit;
    cursor: pointer;
  }

  .link:hover {
    text-decoration: underline;
  }
</style>
