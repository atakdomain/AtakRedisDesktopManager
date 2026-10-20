<script lang="ts">
  // Tarama durumu satırı — sabit yükseklik, sonuçlar akarken yerleşim kaymaz.
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import { t } from "$lib/i18n/index.svelte";
  import { settings } from "$lib/state/settings.svelte";
  import type { Workspace } from "$lib/state/workspace.svelte";
  import Spinner from "$lib/ui/Spinner.svelte";
  import { tooltip } from "$lib/ui/tooltip.svelte";
  import { fmtDuration } from "$lib/util/format";

  let { ws }: { ws: Workspace } = $props();

  const scan = $derived(ws.scan);
  const count = $derived(ws.keyCount);
  const unfiltered = $derived(!ws.filter.term && ws.filter.types.length === 0);
  const dbKeys = $derived(ws.dbs.find((d) => d.index === ws.db)?.keys);
</script>

<div class="status tabular" aria-live="polite">
  {#if scan.error}
    <span class="error" use:tooltip={scan.error.message}><CircleAlert size={12} /> {t("browser.status.error")}</span>
    <button class="link" onclick={() => void ws.search()}>{t("browser.status.retry")}</button>
  {:else if scan.running}
    <Spinner size={11} />
    <span>{t("browser.status.keys", { count })}</span>
    <span class="muted">· {t("browser.status.scanned", { count: scan.scanned })}</span>
    <span class="grow"></span>
    <button class="link" onclick={() => ws.cancelScan()}>{t("browser.status.stop")}</button>
  {:else if !scan.done && count > 0}
    <span>
      {#if unfiltered && dbKeys}
        {t("browser.status.loadedOf", { count, total: dbKeys })}
      {:else}
        {t("browser.status.loaded", { count })}
      {/if}
    </span>
    <span class="grow"></span>
    <button class="link" use:tooltip={t("browser.status.moreHint", { count: settings.scanLimit })} onclick={() => void ws.loadMore()}>{t("browser.status.more")}</button>
    <span class="muted">·</span>
    <button class="link" use:tooltip={t("browser.status.allHint")} onclick={() => void ws.loadAll()}>{t("browser.status.all")}</button>
  {:else}
    <span>{t("browser.status.keys", { count })}</span>
    {#if scan.elapsedMs > 0}<span class="muted">· {fmtDuration(scan.elapsedMs)}</span>{/if}
    {#if !scan.done && count === 0 && scan.scanned > 0}<span class="muted">· {t("browser.status.scanned", { count: scan.scanned })}</span>{/if}
    <span class="grow"></span>
    {#if !scan.done && scan.cursor}
      <button class="link" onclick={() => void ws.loadMore()}>{t("browser.status.more")}</button>
    {/if}
  {/if}
</div>

<style>
  .status {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 24px;
    flex: none;
    padding: 0 10px 2px;
    font-size: var(--fs-xs);
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
  }

  .error {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--danger);
  }

  .link {
    padding: 0 2px;
    border: 0;
    background: none;
    color: var(--accent-text);
    font-size: inherit;
    font-weight: 500;
    cursor: pointer;
  }

  .link:hover {
    text-decoration: underline;
  }
</style>
