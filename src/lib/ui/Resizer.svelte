<script lang="ts">
  // Paneller arası dikey sürükleme tutamacı; çift tık varsayılan genişliğe döner.
  let { width = $bindable(), min, max, initial, side = "left" }: { width: number; min: number; max: number; initial: number; side?: "left" | "right" } = $props();

  let dragging = $state(false);

  function onpointerdown(e: PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    dragging = true;
    const move = (ev: PointerEvent) => {
      const delta = (ev.clientX - startX) * (side === "left" ? 1 : -1);
      width = Math.round(Math.max(min, Math.min(max, startWidth + delta)));
    };
    const up = () => {
      dragging = false;
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  }
</script>

<div class="resizer" class:dragging role="separator" aria-orientation="vertical" {onpointerdown} ondblclick={() => (width = initial)}></div>

<style>
  .resizer {
    position: relative;
    flex: none;
    width: 1px;
    background: var(--border);
    cursor: col-resize;
    z-index: 2;
  }

  .resizer::after {
    content: "";
    position: absolute;
    inset: 0 -3px;
  }

  .resizer:hover,
  .dragging {
    background: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
</style>
