<script lang="ts">
  // Tam INFO çıktısı: bölümler hâlinde anahtar | değer, süzgeçle daraltılır.
  import Search from "@lucide/svelte/icons/search";
  import { t } from "$lib/i18n/index.svelte";
  import type { Info } from "./info";
  import { splitMatch } from "./util";

  let { info }: { info: Info } = $props();

  let filter = $state("");

  const q = $derived(filter.trim());
  const sections = $derived.by(() => {
    if (!q) return info.sections;
    const lower = q.toLowerCase();
    return info.sections
      .map((section) => ({
        name: section.name,
        entries: section.name.toLowerCase().includes(lower) ? section.entries : section.entries.filter(([k, v]) => k.toLowerCase().includes(lower) || v.toLowerCase().includes(lower)),
      }))
      .filter((section) => section.entries.length > 0);
  });
  const total = $derived(sections.reduce((n, s) => n + s.entries.length, 0));
</script>

{#snippet hl(text: string)}
  {@const parts = splitMatch(text, q)}
  {#if parts}{parts[0]}<mark class="hl">{parts[1]}</mark>{parts[2]}{:else}{text}{/if}
{/snippet}

<div class="tools">
  <label class="search">
    <Search size={13} />
    <input bind:value={filter} placeholder={t("server.info.filter")} spellcheck="false" autocomplete="off" />
  </label>
  <span class="muted count tabular">{t("server.info.count", { count: total })}</span>
</div>

{#if sections.length}
  <div class="grid">
    {#each sections as section, si (si)}
      <section class="sec">
        <h3 lang="en">{section.name || "—"}</h3>
        <dl>
          {#each section.entries as [key, value], i (i)}
            <div class="kv">
              <dt class="mono">{@render hl(key)}</dt>
              <dd class="mono selectable">{@render hl(value)}</dd>
            </div>
          {/each}
        </dl>
      </section>
    {/each}
  </div>
{:else}
  <p class="none muted">{t("common.noResults")}</p>
{/if}

<style>
  .tools {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px 4px;
  }

  .search {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 280px;
    height: var(--h-control-sm);
    padding: 0 8px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--bg-input);
    color: var(--text-3);
  }

  .search:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: none;
    outline: none;
    color: var(--text);
    font-size: var(--fs-sm);
  }

  .count {
    font-size: var(--fs-xs);
  }

  .grid {
    columns: 2 380px;
    column-gap: 24px;
    padding: 6px 12px 12px;
  }

  .sec {
    break-inside: avoid;
    margin-bottom: 12px;
  }

  h3 {
    margin: 6px 0 4px;
    color: var(--text-2);
    font-size: var(--fs-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  dl {
    margin: 0;
  }

  .kv {
    display: flex;
    gap: 12px;
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    font-size: var(--fs-xs);
    line-height: 1.6;
  }

  .kv:hover {
    background: var(--bg-hover);
  }

  dt {
    flex: 0 0 46%;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-2);
    font-size: var(--fs-xs);
  }

  dd {
    flex: 1;
    min-width: 0;
    margin: 0;
    overflow-wrap: anywhere;
    color: var(--text);
    font-size: var(--fs-xs);
  }

  .none {
    padding: 16px 12px;
    font-size: var(--fs-sm);
  }
</style>
