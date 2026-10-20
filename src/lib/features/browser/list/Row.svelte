<script lang="ts">
  // Ağaç/liste satırı (26 px). Klasör: ok, klasör simgesi (seçim kipinde onay kutusu), ad, sayı.
  // Anahtar: onay kutusu yuvası, tür rozeti, vurgulu ad, TTL çipi. Yalnızca görünen satırlar çizilir.
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Folder from "@lucide/svelte/icons/folder";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import { fmtNumber, t } from "$lib/i18n/index.svelte";
  import { settings } from "$lib/state/settings.svelte";
  import TypeBadge from "$lib/ui/TypeBadge.svelte";
  import { tooltip } from "$lib/ui/tooltip.svelte";
  import { fmtTtl } from "$lib/util/format";
  import type { BrowserController } from "../controller.svelte";
  import { segments } from "../model/highlight";
  import { rowKey, type TreeRow } from "../model/tree";
  import RowCheck from "./RowCheck.svelte";

  interface Props {
    ctl: BrowserController;
    row: TreeRow;
    index: number;
    /** Seçim kipi: onay kutuları hep görünür */
    checks: boolean;
    oncontextmenu: (e: MouseEvent, row: TreeRow) => void;
  }

  let { ctl, row, index, checks, oncontextmenu }: Props = $props();

  const tree = $derived(!ctl.model.flat);
  const depth = $derived(tree ? row.depth : 0);
  const cursor = $derived(ctl.cursor === rowKey(row));

  const parts = $derived.by(() => {
    if (row.kind === "folder") return segments(row.path, ctl.matcher.ranges(row.path), row.path.length - row.name.length);
    return segments(row.label, ctl.matcher.ranges(row.label), tree ? row.nameStart : 0, row.binary);
  });

  const meta = $derived(row.kind === "key" && settings.showKeyMeta ? ctl.ws.metaOf(row.id) : undefined);
  const check = $derived(row.kind === "folder" ? ctl.folderCheck(row) : ctl.ws.allMatching || ctl.ws.selection.has(row.id) ? "all" : "none");
  const expanded = $derived(row.kind === "folder" && ctl.isExpanded(row));
  const active = $derived(row.kind === "key" && ctl.activeKeyId === row.id);
  const empty = $derived(parts.length === 0);
  // Düğüm nesnesi aynı kalır, sayısı yerinde artar: her satır yenilemesinde (yeni parça) yeniden oku
  const count = $derived.by(() => {
    void ctl.rows;
    return row.kind === "folder" ? row.count : 0;
  });
</script>

<!-- Klavye kapsayıcı listede (BrowserController.keydown); satırlar yalnızca fareyle etkileşir -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="row"
  class:folder={row.kind === "folder"}
  class:selected={check === "all"}
  class:cursor
  class:active
  class:checks
  style:--depth={depth}
  role="treeitem"
  tabindex="-1"
  aria-selected={check === "all"}
  aria-expanded={row.kind === "folder" ? expanded : undefined}
  aria-level={depth + 1}
  aria-label={row.kind === "folder" ? row.name : row.label}
  onclick={(e) => ctl.click(row, index, e)}
  ondblclick={() => ctl.dblclick(row)}
  oncontextmenu={(e) => oncontextmenu(e, row)}
  use:tooltip={row.kind === "key" && tree && row.depth > 0 ? row.label : undefined}
>
  {#if depth > 0}<span class="indent"></span>{/if}
  {#if row.kind === "folder"}
    <span class="chevron" class:open={expanded}><ChevronRight size={13} /></span>
    <span class="lead">
      <span class="icon">
        {#if expanded}<FolderOpen size={14} />{:else}<Folder size={14} />{/if}
      </span>
      <RowCheck state={check} onclick={(e) => ctl.check(row, index, e)} />
    </span>
    <span class="name">
      {#if empty}<span class="muted">{t("browser.row.emptyName")}</span>{/if}
      {#each parts as part, i (i)}{#if part.hl}<mark class="hl">{part.text}</mark>{:else}{part.text}{/if}{/each}
    </span>
    <span class="count tabular" use:tooltip={t("browser.row.folderKeys", { count })}>{fmtNumber(count)}</span>
  {:else}
    <span class="lead key">
      <RowCheck state={check} onclick={(e) => ctl.check(row, index, e)} />
    </span>
    {#if settings.showKeyMeta}<TypeBadge type={meta?.type} />{/if}
    <span class="name" class:binary={row.binary}>
      {#if empty}<span class="muted">{t("browser.row.emptyName")}</span>{/if}
      {#each parts as part, i (i)}{#if part.hl}<mark class="hl" class:esc={part.esc}>{part.text}</mark>{:else if part.esc}<span class="esc">{part.text}</span>{:else}{part.text}{/if}{/each}
    </span>
    {#if meta && meta.ttl >= 0}
      <span class="ttl tabular" class:warn={meta.ttl < 60_000} use:tooltip={t("browser.row.ttl", { ttl: fmtTtl(meta.ttl) })}>{fmtTtl(meta.ttl)}</span>
    {/if}
  {/if}
</div>

<style>
  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    height: var(--h-row);
    padding: 0 8px 0 4px;
    color: var(--text);
    font-size: var(--fs);
    white-space: nowrap;
    cursor: default;
    contain: layout style;
  }

  .row:hover {
    background: var(--bg-hover);
  }

  .row.selected {
    background: var(--bg-selected);
  }

  .row.selected:hover {
    background: var(--bg-selected-strong);
  }

  /* İmleç yalnızca liste odaktayken belirgin */
  :global(.keylist:focus-within) .row.cursor {
    box-shadow: inset 0 0 0 1px var(--accent);
    border-radius: var(--radius-sm);
  }

  .row.active::before {
    content: "";
    position: absolute;
    left: 0;
    top: 4px;
    bottom: 4px;
    width: 2px;
    border-radius: 2px;
    background: var(--accent);
  }

  .indent {
    flex: none;
    align-self: stretch;
    width: calc(var(--depth) * 14px);
    margin-right: -6px;
    background-image: linear-gradient(to right, color-mix(in srgb, var(--text-3) 28%, transparent) 1px, transparent 1px);
    background-size: 14px 100%;
    background-position: 7px 0;
  }

  .chevron {
    display: grid;
    place-items: center;
    flex: none;
    width: 14px;
    margin-right: -4px;
    color: var(--text-3);
    transition: transform var(--dur) var(--ease);
  }

  .chevron.open {
    transform: rotate(90deg);
  }

  .lead {
    position: relative;
    display: grid;
    place-items: center;
    flex: none;
    width: 16px;
    height: 16px;
  }

  .lead > :global(*) {
    grid-area: 1 / 1;
  }

  .icon {
    display: grid;
    color: var(--text-3);
  }

  .folder .icon {
    color: color-mix(in srgb, var(--accent) 70%, var(--text-3));
  }

  /* Onay kutusu: üzerine gelince ya da seçim kipinde görünür; klasörde simgenin yerini alır */
  .lead :global(.rowcheck) {
    opacity: 0;
  }

  .row:hover .lead :global(.rowcheck),
  .row.checks .lead :global(.rowcheck) {
    opacity: 1;
  }

  .row:hover .icon,
  .row.checks .icon {
    opacity: 0;
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .folder .name {
    font-weight: 500;
  }

  .name.binary {
    font-family: var(--font-mono);
    font-size: var(--fs-mono);
  }

  .esc {
    color: var(--text-3);
  }

  .count {
    flex: none;
    min-width: 18px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--bg-active);
    color: var(--text-2);
    font-size: var(--fs-2xs);
    font-weight: 600;
    line-height: 16px;
    text-align: center;
  }

  .ttl {
    flex: none;
    padding: 0 5px;
    border-radius: var(--radius-sm);
    color: var(--text-3);
    font-size: var(--fs-2xs);
    font-weight: 500;
    line-height: 16px;
  }

  .ttl.warn {
    background: var(--warning-soft);
    color: var(--warning);
  }
</style>
