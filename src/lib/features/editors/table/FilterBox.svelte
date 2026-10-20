<script lang="ts">
  // Süzgeç kutusu + kendi "Aa" (büyük/küçük harf duyarlı) düğmesi. Yazarken gecikmeli, Enter'da hemen bildirir.
  import CaseSensitive from "@lucide/svelte/icons/case-sensitive";
  import Search from "@lucide/svelte/icons/search";
  import X from "@lucide/svelte/icons/x";
  import { t } from "$lib/i18n/index.svelte";
  import { tooltip } from "$lib/ui/tooltip.svelte";

  interface Props {
    term: string;
    caseSensitive: boolean;
    placeholder: string;
    onchange: () => void;
    /** Süzme sunucuda mı (ipucu metni için) */
    server?: boolean;
  }

  let { term = $bindable(), caseSensitive = $bindable(), placeholder, onchange, server = false }: Props = $props();

  let input = $state<HTMLInputElement>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(onchange, 250);
  }

  function now() {
    clearTimeout(timer);
    onchange();
  }

  $effect(() => () => clearTimeout(timer));

  export function focus(): void {
    input?.focus();
    input?.select();
  }
</script>

<div class="filter" class:active={!!term}>
  <Search size={13} />
  <input
    bind:this={input}
    class="field"
    bind:value={term}
    {placeholder}
    spellcheck="false"
    autocomplete="off"
    aria-label={placeholder}
    oninput={schedule}
    onkeydown={(e) => {
      if (e.key === "Enter") now();
      else if (e.key === "Escape" && term) {
        e.preventDefault();
        e.stopPropagation();
        term = "";
        now();
      }
    }}
  />
  {#if term}
    <button
      class="icon-btn"
      aria-label={t("common.clear")}
      onclick={() => {
        term = "";
        now();
        input?.focus();
      }}><X size={13} /></button
    >
  {/if}
  <button
    class="icon-btn case"
    class:on={caseSensitive}
    aria-pressed={caseSensitive}
    aria-label={t("editors.filter.caseSensitive")}
    use:tooltip={`${t("editors.filter.caseSensitive")}${server ? " · " + t("editors.filter.serverHint") : ""}`}
    onclick={() => {
      caseSensitive = !caseSensitive;
      if (term) now();
    }}><CaseSensitive size={15} /></button
  >
</div>

<style>
  .filter {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    max-width: 320px;
    min-width: 120px;
    flex: 1 1 220px;
    height: var(--h-control-sm);
    padding: 0 2px 0 8px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--bg-input);
    color: var(--text-3);
    transition:
      border-color var(--dur) var(--ease),
      box-shadow var(--dur) var(--ease);
  }

  .filter:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .filter.active {
    color: var(--accent-text);
  }

  .field {
    flex: 1;
    min-width: 0;
    height: 100%;
    border: 0;
    background: none;
    color: var(--text);
    font-size: var(--fs-sm);
    outline: none;
  }

  .field::placeholder {
    color: var(--text-3);
  }

  .icon-btn {
    display: grid;
    place-items: center;
    flex: none;
    width: 20px;
    height: 18px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-3);
    cursor: pointer;
  }

  .icon-btn:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .case {
    width: 24px;
  }

  .case.on {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
</style>
