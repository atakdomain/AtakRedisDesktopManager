<script lang="ts">
  // İşleme göre seçenekler; tümü akışın taslağına (flow.draft) bağlı.
  import { t } from "$lib/i18n/index.svelte";
  import type { BulkFlow } from "../flow.svelte";
  import CopyOptions from "./CopyOptions.svelte";
  import ExportOptions from "./ExportOptions.svelte";
  import RenameOptions from "./RenameOptions.svelte";
  import TtlOptions from "./TtlOptions.svelte";

  let { flow }: { flow: BulkFlow } = $props();
</script>

{#if flow.draft.action === "delete"}
  <div class="options">
    <label class="check">
      <input type="checkbox" bind:checked={flow.draft.backup} />
      <span>{t("bulk.options.backup")}</span>
    </label>
    <p class="hint indent">{t("bulk.options.backupHint")}</p>
  </div>
{:else if flow.draft.action === "expire"}
  <TtlOptions {flow} />
{:else if flow.draft.action === "rename"}
  <RenameOptions {flow} />
{:else if flow.draft.action === "copy"}
  <CopyOptions {flow} />
{:else}
  <ExportOptions {flow} />
{/if}

<style>
  .options {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .indent {
    margin-top: -6px;
    padding-left: 23px;
  }
</style>
