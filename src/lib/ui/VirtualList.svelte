<script lang="ts">
  // Sabit satır yükseklikli sanal liste: yalnızca görünen satırlar (+ tampon) DOM'dadır.
  import type { Snippet } from "svelte";

  interface Props {
    count: number;
    rowHeight: number;
    overscan?: number;
    row: Snippet<[number]>;
    /** Görünen aralık değişince [start, end) */
    onrange?: (start: number, end: number) => void;
    /** Liste boşken gösterilecek içerik */
    empty?: Snippet;
    /** Konteynerin kendi klavye/odak davranışı için */
    tabindex?: number;
    onkeydown?: (e: KeyboardEvent) => void;
    onfocus?: (e: FocusEvent) => void;
    oncontextmenu?: (e: MouseEvent) => void;
    role?: string;
    label?: string;
    footer?: Snippet;
  }

  let { count, rowHeight, overscan = 10, row, onrange, empty, tabindex, onkeydown, onfocus, oncontextmenu, role = "list", label, footer }: Props = $props();

  let viewport = $state<HTMLDivElement>();
  let scrollTop = $state(0);
  let height = $state(0);

  const start = $derived(Math.max(0, Math.floor(scrollTop / rowHeight) - overscan));
  const end = $derived(Math.min(count, Math.ceil((scrollTop + height) / rowHeight) + overscan));
  const indexes = $derived(Array.from({ length: Math.max(0, end - start) }, (_, i) => start + i));

  $effect(() => {
    if (!viewport) return;
    const observer = new ResizeObserver(() => (height = viewport!.clientHeight));
    observer.observe(viewport);
    height = viewport.clientHeight;
    return () => observer.disconnect();
  });

  $effect(() => {
    const visibleStart = Math.floor(scrollTop / rowHeight);
    const visibleEnd = Math.min(count, Math.ceil((scrollTop + height) / rowHeight));
    onrange?.(visibleStart, visibleEnd);
  });

  /** Satırı görünür kılar; `align: "auto"` zaten görünüyorsa kaydırmaz. */
  export function scrollToIndex(index: number, align: "auto" | "start" | "center" = "auto"): void {
    if (!viewport) return;
    const top = index * rowHeight;
    const bottom = top + rowHeight;
    const view = viewport.clientHeight;
    if (align === "start") viewport.scrollTop = top;
    else if (align === "center") viewport.scrollTop = top - view / 2 + rowHeight / 2;
    else if (top < viewport.scrollTop) viewport.scrollTop = top;
    else if (bottom > viewport.scrollTop + view) viewport.scrollTop = bottom - view;
  }

  export function focus(): void {
    viewport?.focus();
  }

  export function element(): HTMLDivElement | undefined {
    return viewport;
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="viewport"
  bind:this={viewport}
  onscroll={(e) => (scrollTop = (e.currentTarget as HTMLDivElement).scrollTop)}
  {tabindex}
  {onkeydown}
  {onfocus}
  {oncontextmenu}
  {role}
  aria-label={label}
>
  {#if count === 0 && empty}
    {@render empty()}
  {:else}
    <div class="spacer" style:height="{count * rowHeight}px">
      <div class="window" style:transform="translateY({start * rowHeight}px)">
        <!-- Anahtarsız: kaydırırken satır DOM'u yeniden kullanılır, yalnızca prop'lar güncellenir -->
        {#each indexes as index}
          {@render row(index)}
        {/each}
      </div>
    </div>
    {#if footer}{@render footer()}{/if}
  {/if}
</div>

<style>
  .viewport {
    position: relative;
    height: 100%;
    overflow: auto;
    overscroll-behavior: contain;
    contain: strict;
  }

  .spacer {
    position: relative;
    width: 100%;
  }

  .window {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    will-change: transform;
  }
</style>
