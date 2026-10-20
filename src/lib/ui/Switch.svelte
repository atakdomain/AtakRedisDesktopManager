<script lang="ts">
  import type { Snippet } from "svelte";

  let { checked = $bindable(false), disabled = false, children, onchange }: { checked: boolean; disabled?: boolean; children?: Snippet; onchange?: (checked: boolean) => void } = $props();
</script>

<label class="switch" class:disabled>
  <input type="checkbox" role="switch" bind:checked {disabled} onchange={() => onchange?.(checked)} />
  <span class="track"><span class="thumb"></span></span>
  {#if children}<span class="text">{@render children()}</span>{/if}
</label>

<style>
  .switch {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
  }

  .disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  input {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
  }

  .track {
    position: relative;
    flex: none;
    width: 30px;
    height: 18px;
    border-radius: 999px;
    background: var(--border-strong);
    transition: background var(--dur) var(--ease);
  }

  .thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
    transition: transform var(--dur) var(--ease);
  }

  input:checked + .track {
    background: var(--accent);
  }

  input:checked + .track .thumb {
    transform: translateX(12px);
  }

  input:focus-visible + .track {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .text {
    font-size: var(--fs);
  }
</style>
