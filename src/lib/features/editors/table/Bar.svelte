<script lang="ts">
  // Koleksiyon düzenleyicilerinin üst araç çubuğu (süzgeç, sayaç, ekle/sil).
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();
</script>

<div class="bar">{@render children()}</div>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
    height: 38px;
    min-width: 0;
    overflow: hidden;
    padding: 0 8px 0 10px;
    border-bottom: 1px solid var(--border-subtle);
    font-size: var(--fs-sm);
    container: bar / inline-size;
  }

  /* Dar panelde düğme metinleri gizlenir, simgeler kalır */
  @container bar (max-width: 480px) {
    .bar :global(.btn .label) {
      display: none;
    }
  }

  .bar :global(.count) {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text-3);
    white-space: nowrap;
  }

  .bar :global(.btn) {
    flex: none;
  }

  .bar :global(.spacer) {
    flex: 1;
  }
</style>
