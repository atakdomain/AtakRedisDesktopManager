<script lang="ts">
  // Satır içi SVG çizgi grafik: son örnekler, alanı hafif dolgulu. Grafik kütüphanesi yok.
  let { values, height = 36, label }: { values: readonly number[]; height?: number; label?: string } = $props();

  const W = 200;

  const shape = $derived.by(() => {
    if (values.length < 2) return null;
    const max = Math.max(...values, 1);
    const step = W / (values.length - 1);
    const pad = 2;
    const y = (v: number) => pad + (height - pad * 2) * (1 - v / max);
    const points = values.map((v, i) => `${(i * step).toFixed(1)},${y(v).toFixed(1)}`);
    return {
      line: `M${points.join(" L")}`,
      area: `M0,${height} L${points.join(" L")} L${W},${height} Z`,
    };
  });
</script>

<svg class="spark" viewBox="0 0 {W} {height}" preserveAspectRatio="none" style:height="{height}px" role="img" aria-label={label}>
  {#if shape}
    <path class="area" d={shape.area} />
    <path class="line" d={shape.line} vector-effect="non-scaling-stroke" />
  {:else}
    <line class="base" x1="0" x2={W} y1={height - 1} y2={height - 1} vector-effect="non-scaling-stroke" />
  {/if}
</svg>

<style>
  .spark {
    display: block;
    width: 100%;
    overflow: visible;
  }

  .area {
    fill: var(--accent-soft);
  }

  .line {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.5;
    stroke-linejoin: round;
  }

  .base {
    stroke: var(--border);
    stroke-width: 1;
    stroke-dasharray: 3 3;
  }
</style>
