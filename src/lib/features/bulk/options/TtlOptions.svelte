<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import Segmented from "$lib/ui/Segmented.svelte";
  import type { BulkFlow } from "../flow.svelte";
  import type { TtlMode, TtlUnit } from "../model/draft";

  let { flow }: { flow: BulkFlow } = $props();

  const draft = $derived(flow.draft);
  const UNITS: TtlUnit[] = ["s", "m", "h", "d"];
  const PRESETS: { key: "m1" | "h1" | "d1" | "d7" | "d30"; amount: number; unit: TtlUnit }[] = [
    { key: "m1", amount: 1, unit: "m" },
    { key: "h1", amount: 1, unit: "h" },
    { key: "d1", amount: 1, unit: "d" },
    { key: "d7", amount: 7, unit: "d" },
    { key: "d30", amount: 30, unit: "d" },
  ];

  const modes = $derived<{ value: TtlMode; label: string }[]>([
    { value: "relative", label: t("bulk.options.ttlRelative") },
    { value: "absolute", label: t("bulk.options.ttlAbsolute") },
    { value: "persist", label: t("bulk.options.ttlPersist") },
  ]);

  function localNow(): string {
    const d = new Date(Date.now() + 60_000);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }
</script>

<div class="options">
  <Segmented options={modes} bind:value={flow.draft.ttlMode} size="sm" />

  {#if draft.ttlMode === "relative"}
    <div class="field">
      <label for="bulk-ttl-amount">{t("bulk.options.ttlAmount")}</label>
      <div class="row">
        <input id="bulk-ttl-amount" class="input tabular amount" type="number" min="1" step="1" bind:value={flow.draft.ttlAmount} />
        <select class="select unit" bind:value={flow.draft.ttlUnit} aria-label={t("bulk.options.ttlAmount")}>
          {#each UNITS as unit (unit)}<option value={unit}>{t(`bulk.options.units.${unit}`)}</option>{/each}
        </select>
      </div>
      <div class="presets">
        {#each PRESETS as preset (preset.key)}
          <button
            class="chip"
            class:on={draft.ttlAmount === preset.amount && draft.ttlUnit === preset.unit}
            onclick={() => {
              flow.draft.ttlAmount = preset.amount;
              flow.draft.ttlUnit = preset.unit;
            }}>{t(`bulk.options.presets.${preset.key}`)}</button
          >
        {/each}
      </div>
    </div>
  {:else if draft.ttlMode === "absolute"}
    <div class="field">
      <label for="bulk-ttl-at">{t("bulk.options.ttlAt")}</label>
      <input id="bulk-ttl-at" class="input tabular" type="datetime-local" min={localNow()} bind:value={flow.draft.ttlAt} />
    </div>
  {:else}
    <p class="hint">{t("bulk.options.persistHint")}</p>
  {/if}

  {#if draft.ttlMode !== "persist"}
    <label class="check">
      <input type="checkbox" bind:checked={flow.draft.onlyWithoutTtl} />
      <span>{t("bulk.options.onlyWithoutTtl")}</span>
    </label>
    <p class="hint indent">{t("bulk.options.onlyWithoutTtlHint")}</p>
  {/if}
</div>

<style>
  .options {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .amount {
    width: 110px;
    flex: none;
  }

  .unit {
    width: auto;
    flex: 1;
  }

  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .chip {
    height: 22px;
    padding: 0 9px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg-elevated);
    color: var(--text-2);
    font-size: var(--fs-xs);
    cursor: pointer;
  }

  .chip:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .chip.on {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent-text);
    font-weight: 600;
  }

  .indent {
    margin-top: -6px;
    padding-left: 23px;
  }
</style>
