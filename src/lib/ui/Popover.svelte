<script lang="ts">
  // Çapaya bağlı açılır panel (süzgeçler, iş listesi). Dışarı tıklama ve Esc kapatır.
  import type { Snippet } from "svelte";
  import { place } from "$lib/util/position";

  interface Props {
    anchor: HTMLElement;
    onclose: () => void;
    align?: "start" | "end";
    width?: number;
    children: Snippet;
  }

  let { anchor, onclose, align = "start", width, children }: Props = $props();
  let el = $state<HTMLDivElement>();

  $effect(() => {
    if (!el) return;
    place(el, anchor, align, 6);
    const observer = new ResizeObserver(() => el && place(el, anchor, align, 6));
    observer.observe(el);
    return () => observer.disconnect();
  });
</script>

<svelte:window
  onpointerdown={(e) => {
    const target = e.target as Node;
    if (el && !el.contains(target) && !anchor.contains(target)) onclose();
  }}
  onkeydown={(e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onclose();
    }
  }}
  onresize={onclose}
/>

<div class="popover" bind:this={el} style:width={width ? `${width}px` : undefined} role="dialog">
  {@render children()}
</div>

<style>
  .popover {
    position: fixed;
    z-index: var(--z-popover);
    max-height: calc(100vh - 16px);
    overflow: auto;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    animation: pop 100ms var(--ease);
  }

  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(-2px);
    }
  }
</style>
