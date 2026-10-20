<script lang="ts">
  // Sanal anahtar listesi/ağacı + boş durumlar. Klavye ve seçim BrowserController'da.
  import Database from "@lucide/svelte/icons/database";
  import SearchX from "@lucide/svelte/icons/search-x";
  import { t } from "$lib/i18n/index.svelte";
  import EmptyState from "$lib/ui/EmptyState.svelte";
  import Spinner from "$lib/ui/Spinner.svelte";
  import VirtualList from "$lib/ui/VirtualList.svelte";
  import type { BrowserController } from "../controller.svelte";
  import { rowKey, type TreeRow } from "../model/tree";
  import Row from "./Row.svelte";

  interface Props {
    ctl: BrowserController;
    onrowmenu: (e: MouseEvent, row: TreeRow) => void;
    onemptymenu: (e: MouseEvent) => void;
    onnewkey: () => void;
    /** Boş sonuçta önerilen düzeltmeler */
    onrelax: (what: "case" | "mode" | "types" | "term") => void;
  }

  let { ctl, onrowmenu, onemptymenu, onnewkey, onrelax }: Props = $props();

  const ws = $derived(ctl.ws);
  const rows = $derived(ctl.rows);
  const checks = $derived(ws.selection.size > 0 || ws.allMatching);
  const filtered = $derived(ws.filter.term !== "" || ws.filter.types.length > 0);

  let list = $state<VirtualList>();

  $effect(() => {
    const current = list;
    ctl.list = current ? { scrollToIndex: (i, align) => current.scrollToIndex(i, align), focus: () => current.focus() } : null;
    return () => (ctl.list = null);
  });

  function onfocus(): void {
    if (ctl.cursorIndex() >= 0 || rows.length === 0) return;
    const selected = rows.findIndex((r) => r.kind === "key" && ws.selection.has(r.id));
    ctl.cursor = rowKey(rows[Math.max(0, selected)]);
  }
</script>

<div class="keylist">
  <VirtualList
    bind:this={list}
    count={rows.length}
    rowHeight={26}
    overscan={12}
    tabindex={0}
    role="tree"
    label={t("browser.title")}
    onkeydown={(e) => ctl.keydown(e)}
    {onfocus}
    oncontextmenu={onemptymenu}
    onrange={(start, end) => (ctl.range = [start, end])}
  >
    {#snippet row(index)}
      {@const item = rows[index]}
      {#if item}<Row {ctl} row={item} {index} {checks} oncontextmenu={onrowmenu} />{/if}
    {/snippet}
    {#snippet footer()}<div class="pad"></div>{/snippet}
    {#snippet empty()}
      {#if ws.scan.running || (!ws.scan.done && !ws.scan.error && ws.scan.scanned === 0)}
        <div class="scanning"><Spinner size={14} /> {t("browser.empty.scanning")}</div>
      {:else if !filtered}
        <EmptyState icon={Database} title={t("browser.empty.dbTitle")} description={t("browser.empty.dbText")} compact>
          {#if !ws.readOnly}<button class="btn sm" onclick={onnewkey}>{t("browser.header.newKey")}</button>{/if}
        </EmptyState>
      {:else}
        <EmptyState icon={SearchX} title={t("browser.empty.noMatchTitle")} description={t("browser.empty.noMatchText", { count: ws.scan.scanned })} compact>
          <div class="fixes">
            {#if ws.filter.caseSensitive && ws.filter.term}<button class="btn sm" onclick={() => onrelax("case")}>{t("browser.empty.tryInsensitive")}</button>{/if}
            {#if ws.filter.mode !== "contains" && ws.filter.term}<button class="btn sm" onclick={() => onrelax("mode")}>{t("browser.empty.tryContains")}</button>{/if}
            {#if ws.filter.types.length}<button class="btn sm" onclick={() => onrelax("types")}>{t("browser.empty.clearTypes")}</button>{/if}
            {#if ws.filter.term}<button class="btn ghost sm" onclick={() => onrelax("term")}>{t("browser.empty.clearSearch")}</button>{/if}
          </div>
        </EmptyState>
      {/if}
    {/snippet}
  </VirtualList>
</div>

<style>
  .keylist {
    position: relative;
    flex: 1;
    min-height: 0;
  }

  .keylist :global([role="tree"]:focus-visible) {
    outline: none;
  }

  .pad {
    height: 56px;
  }

  .scanning {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 100%;
    color: var(--text-3);
    font-size: var(--fs-sm);
  }

  .fixes {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
</style>
