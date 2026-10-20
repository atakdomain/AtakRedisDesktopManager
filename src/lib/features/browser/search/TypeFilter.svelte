<script lang="ts">
  // Tür süzgeci: onay kutuları + satır başına "yalnızca bu". Boş liste = tüm türler.
  import { t } from "$lib/i18n/index.svelte";
  import Popover from "$lib/ui/Popover.svelte";
  import TypeBadge from "$lib/ui/TypeBadge.svelte";

  interface Props {
    anchor: HTMLElement;
    types: readonly string[];
    onchange: (types: string[]) => void;
    onclose: () => void;
  }

  let { anchor, types, onchange, onclose }: Props = $props();

  const TYPES = [
    { type: "string", label: () => t("common.types.string") },
    { type: "hash", label: () => t("common.types.hash") },
    { type: "list", label: () => t("common.types.list") },
    { type: "set", label: () => t("common.types.set") },
    { type: "zset", label: () => t("common.types.zset") },
    { type: "stream", label: () => t("common.types.stream") },
    { type: "ReJSON-RL", label: () => t("common.types.json") },
  ];

  function toggle(type: string): void {
    onchange(types.includes(type) ? types.filter((x) => x !== type) : [...types, type]);
  }
</script>

<Popover {anchor} {onclose} align="end" width={220}>
  <div class="head">
    <span class="title">{t("browser.search.typesTitle")}</span>
    <button class="btn ghost sm" disabled={types.length === 0} onclick={() => onchange([])}>{t("browser.search.allTypes")}</button>
  </div>
  <ul>
    {#each TYPES as item (item.type)}
      <li>
        <label class="check">
          <input type="checkbox" checked={types.includes(item.type)} onchange={() => toggle(item.type)} />
          <TypeBadge type={item.type} />
          <span class="grow">{item.label()}</span>
        </label>
        <button class="only" onclick={() => onchange([item.type])}>{t("browser.search.only")}</button>
      </li>
    {/each}
  </ul>
</Popover>

<style>
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 8px 4px 12px;
  }

  .title {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-2);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 2px 6px 6px;
  }

  li {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 28px;
    padding: 0 4px 0 6px;
    border-radius: var(--radius);
  }

  li:hover {
    background: var(--bg-hover);
  }

  .check {
    flex: 1;
    min-width: 0;
    height: 100%;
  }

  .only {
    flex: none;
    padding: 1px 6px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--accent-text);
    font-size: var(--fs-xs);
    cursor: pointer;
    opacity: 0;
  }

  li:hover .only,
  .only:focus-visible {
    opacity: 1;
  }

  .only:hover {
    background: var(--accent-soft);
  }
</style>
