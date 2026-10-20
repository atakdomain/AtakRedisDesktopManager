<script lang="ts">
  // Süzgeç eşleşmelerini <mark> ile vurgular (foldCase uzunluğu koruduğundan aralıklar metne denk gelir).
  import type { Matcher } from "$lib/util/match";

  let { text, matcher = null }: { text: string; matcher?: Matcher | null } = $props();

  const parts = $derived.by(() => {
    const ranges = matcher ? matcher.ranges(text) : [];
    if (ranges.length === 0) return [{ text, hit: false }];
    const out: { text: string; hit: boolean }[] = [];
    let last = 0;
    for (const [start, end] of ranges) {
      if (start > last) out.push({ text: text.slice(last, start), hit: false });
      out.push({ text: text.slice(start, end), hit: true });
      last = end;
    }
    if (last < text.length) out.push({ text: text.slice(last), hit: false });
    return out;
  });
</script>

{#each parts as part, i (i)}{#if part.hit}<mark class="hl">{part.text}</mark>{:else}{part.text}{/if}{/each}
