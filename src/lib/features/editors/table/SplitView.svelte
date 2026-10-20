<script lang="ts">
  // Üstte tablo, altta detay paneli; aradaki çubuk sürüklenerek boyutlanır (çift tık varsayılana döner).
  import type { Snippet } from "svelte";

  interface Props {
    /** Detay panelinin yüksekliği (px) */
    size: number;
    showDetail: boolean;
    children: Snippet;
    detail: Snippet;
    min?: number;
    initial?: number;
  }

  let { size = $bindable(), showDetail, children, detail, min = 120, initial = 300 }: Props = $props();

  let container = $state<HTMLDivElement>();
  let dragging = $state(false);

  function onpointerdown(e: PointerEvent) {
    if (!container) return;
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const start = size;
    const max = container.clientHeight - 90;
    dragging = true;
    const move = (ev: PointerEvent) => {
      size = Math.round(Math.max(min, Math.min(max, start - (ev.clientY - startY))));
    };
    const up = () => {
      dragging = false;
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "ArrowUp") size += 24;
    else if (e.key === "ArrowDown") size = Math.max(min, size - 24);
    else return;
    e.preventDefault();
  }
</script>

<div class="split" bind:this={container}>
  <div class="top">{@render children()}</div>
  {#if showDetail}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      class="bar"
      class:dragging
      role="separator"
      aria-orientation="horizontal"
      aria-valuenow={size}
      tabindex="0"
      {onpointerdown}
      {onkeydown}
      ondblclick={() => (size = initial)}
    ></div>
    <div class="bottom" style:height="{size}px">{@render detail()}</div>
  {/if}
</div>

<style>
  .split {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .top {
    flex: 1;
    min-height: 60px;
  }

  .bottom {
    display: flex;
    flex-direction: column;
    flex: none;
    min-height: 0;
    max-height: calc(100% - 90px);
    background: var(--bg);
  }

  .bar {
    position: relative;
    flex: none;
    height: 1px;
    background: var(--border);
    cursor: row-resize;
    z-index: 2;
  }

  .bar::after {
    content: "";
    position: absolute;
    inset: -3px 0;
  }

  .bar:hover,
  .bar:focus-visible,
  .dragging {
    background: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
    outline: none;
  }
</style>
