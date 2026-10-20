<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import { closeMenu, menu, type MenuItem } from "$lib/state/menu.svelte";
  import { place } from "$lib/util/position";
  import Kbd from "./Kbd.svelte";

  let el = $state<HTMLDivElement>();
  let active = $state(-1);

  const current = $derived(menu.current);
  const actionable = (item: MenuItem) => (item.kind ?? "item") === "item" && !("disabled" in item && item.disabled);

  $effect(() => {
    if (!current || !el) return;
    active = -1;
    place(el, current.anchor, current.align);
    el.focus();
  });

  function move(delta: number) {
    if (!current) return;
    const n = current.items.length;
    for (let i = 1; i <= n; i++) {
      const index = (active + delta * i + n * 2) % n;
      if (actionable(current.items[index])) {
        active = index;
        return;
      }
    }
  }

  function choose(item: MenuItem) {
    if (!actionable(item) || (item.kind ?? "item") !== "item") return;
    closeMenu();
    void (item as Extract<MenuItem, { run: unknown }>).run();
  }

  function onkeydown(e: KeyboardEvent) {
    if (!current) return;
    e.stopPropagation();
    if (e.key === "ArrowDown") move(1);
    else if (e.key === "ArrowUp") move(-1);
    else if (e.key === "Enter" || e.key === " ") {
      if (active >= 0) choose(current.items[active]);
    } else if (e.key === "Escape" || e.key === "Tab") closeMenu();
    else return;
    e.preventDefault();
  }
</script>

<svelte:window
  onpointerdown={(e) => {
    if (current && el && !el.contains(e.target as Node)) closeMenu();
  }}
  onblur={() => current && closeMenu()}
  onresize={() => current && closeMenu()}
/>

{#if current}
  <div class="menu" bind:this={el} role="menu" tabindex="-1" style:min-width="{current.minWidth}px" {onkeydown}>
    {#each current.items as item, i (i)}
      {#if item.kind === "separator"}
        <div class="sep" role="separator"></div>
      {:else if item.kind === "header"}
        <div class="header">{item.label}</div>
      {:else}
        <button
          class="item"
          class:danger={item.danger}
          class:active={active === i}
          role="menuitem"
          disabled={item.disabled}
          onpointerenter={() => (active = item.disabled ? -1 : i)}
          onclick={() => choose(item)}
        >
          <span class="icon">
            {#if item.checked !== undefined}
              {#if item.checked}<Check size={14} />{/if}
            {:else if item.icon}
              <item.icon size={14} />
            {/if}
          </span>
          <span class="label">{item.label}</span>
          {#if item.hint}<span class="hint">{item.hint}</span>{/if}
          {#if item.shortcut}<Kbd shortcut={item.shortcut} subtle />{/if}
        </button>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .menu {
    position: fixed;
    z-index: var(--z-popover);
    max-width: 360px;
    max-height: calc(100vh - 16px);
    overflow-y: auto;
    padding: 4px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    animation: pop 90ms var(--ease);
  }

  @keyframes pop {
    from {
      opacity: 0;
      transform: scale(0.98);
    }
  }

  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 28px;
    padding: 0 8px 0 6px;
    border: 0;
    border-radius: var(--radius);
    background: none;
    text-align: left;
    font-size: var(--fs);
    color: var(--text);
    cursor: pointer;
  }

  .item.active {
    background: var(--bg-hover);
  }

  .item:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .item.danger {
    color: var(--danger);
  }

  .item.danger.active {
    background: var(--danger-soft);
  }

  .icon {
    display: grid;
    place-items: center;
    width: 16px;
    flex: none;
    color: var(--text-2);
  }

  .danger .icon {
    color: inherit;
  }

  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hint {
    color: var(--text-3);
    font-size: var(--fs-sm);
  }

  .sep {
    height: 1px;
    margin: 4px 6px;
    background: var(--border);
  }

  .header {
    padding: 6px 8px 4px 30px;
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
</style>
