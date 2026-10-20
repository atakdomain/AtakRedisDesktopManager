<script lang="ts">
  /** `value` 0–1; null → belirsiz (kayan şerit) */
  let { value, tone = "accent" }: { value: number | null; tone?: "accent" | "danger" | "success" } = $props();
</script>

<div class="progress {tone}" class:indeterminate={value === null} role="progressbar" aria-valuenow={value === null ? undefined : Math.round(value * 100)}>
  <div class="bar" style:width={value === null ? "35%" : `${Math.max(0, Math.min(1, value)) * 100}%`}></div>
</div>

<style>
  .progress {
    position: relative;
    height: 6px;
    border-radius: 999px;
    background: var(--bg-active);
    overflow: hidden;
  }

  .bar {
    height: 100%;
    border-radius: inherit;
    background: var(--accent);
    transition: width 160ms var(--ease);
  }

  .danger .bar {
    background: var(--danger);
  }

  .success .bar {
    background: var(--success);
  }

  .indeterminate .bar {
    position: absolute;
    animation: slide 1.1s var(--ease) infinite;
  }

  @keyframes slide {
    from {
      left: -35%;
    }
    to {
      left: 100%;
    }
  }
</style>
