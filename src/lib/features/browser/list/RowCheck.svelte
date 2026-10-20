<script lang="ts">
  // Satır onay kutusu (görsel; satırın kendisi klavyeyle seçilir). "some": klasörün bir kısmı seçili.
  let { state, onclick }: { state: "all" | "some" | "none"; onclick: (e: MouseEvent) => void } = $props();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<span
  class="rowcheck"
  class:on={state !== "none"}
  role="checkbox"
  tabindex="-1"
  aria-checked={state === "all" ? true : state === "some" ? "mixed" : false}
  {onclick}
  ondblclick={(e) => e.stopPropagation()}
>
  {#if state === "all"}
    <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 5.2 4.1 7.2 8 3" /></svg>
  {:else if state === "some"}
    <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2.5 5h5" /></svg>
  {/if}
</span>

<style>
  .rowcheck {
    display: grid;
    place-items: center;
    width: 14px;
    height: 14px;
    border: 1.5px solid var(--border-strong);
    border-radius: 4px;
    background: var(--bg-input);
    cursor: pointer;
    transition:
      opacity var(--dur) var(--ease),
      background var(--dur) var(--ease),
      border-color var(--dur) var(--ease);
  }

  .rowcheck:hover {
    border-color: var(--accent);
  }

  .rowcheck.on {
    background: var(--accent);
    border-color: var(--accent);
  }

  svg {
    width: 10px;
    height: 10px;
    fill: none;
    stroke: #fff;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
