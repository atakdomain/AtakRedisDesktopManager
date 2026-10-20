<script lang="ts">
  // TTL rozeti: canlı geri sayım; tıklayınca süre (birimli), mutlak tarih ya da "süresiz" seçilen açılır panel.
  import Hourglass from "@lucide/svelte/icons/hourglass";
  import InfinityIcon from "@lucide/svelte/icons/infinity";
  import { tick, untrack } from "svelte";
  import { t } from "$lib/i18n/index.svelte";
  import Popover from "$lib/ui/Popover.svelte";
  import { tooltip } from "$lib/ui/tooltip.svelte";
  import { fmtDate } from "$lib/util/format";
  import { bestUnit, parseTtl, splitDuration, type TtlUnit } from "../ttl";

  interface Props {
    /** ms; -1 süresiz; null henüz bilinmiyor */
    ttl: number | null;
    readOnly: boolean;
    /** ms; <= 0 → süreyi kaldır */
    onapply: (ms: number) => Promise<boolean>;
    onexpired: () => void;
  }

  let { ttl, readOnly, onapply, onexpired }: Props = $props();

  let chip = $state<HTMLButtonElement>();
  let open = $state(false);
  let expiresAt = $state<number | null>(null);
  let now = $state(Date.now());

  $effect(() => {
    const value = ttl;
    untrack(() => {
      now = Date.now();
      expiresAt = value !== null && value >= 0 ? now + value : null;
    });
  });

  $effect(() => {
    const at = expiresAt;
    if (at === null) return;
    const timer = setInterval(() => {
      now = Date.now();
      if (now >= at) {
        clearInterval(timer);
        onexpired();
      }
    }, 1000);
    return () => clearInterval(timer);
  });

  const remaining = $derived(expiresAt === null ? null : Math.max(0, expiresAt - now));

  function countdown(ms: number): string {
    const { days, hours, minutes, seconds } = splitDuration(ms);
    if (days > 0) return `${t("common.ttl.days", { n: days })} ${t("common.ttl.hours", { n: hours })}`;
    if (hours > 0) return `${t("common.ttl.hours", { n: hours })} ${t("common.ttl.minutes", { n: minutes })}`;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  // ───── açılır panel ─────
  let input = $state("");
  let unit = $state<TtlUnit>("s");
  let at = $state("");
  let error = $state<string | null>(null);
  let busy = $state(false);
  let field = $state<HTMLInputElement>();

  const presets: { label: () => string; ms: number }[] = [
    { label: () => t("common.ttl.minutes", { n: 1 }), ms: 60_000 },
    { label: () => t("common.ttl.minutes", { n: 10 }), ms: 600_000 },
    { label: () => t("common.ttl.hours", { n: 1 }), ms: 3_600_000 },
    { label: () => t("common.ttl.days", { n: 1 }), ms: 86_400_000 },
    { label: () => t("common.ttl.days", { n: 7 }), ms: 604_800_000 },
    { label: () => t("common.ttl.days", { n: 30 }), ms: 2_592_000_000 },
  ];

  const units: TtlUnit[] = ["s", "m", "h", "d"];

  function localInput(ms: number): string {
    const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
    return d.toISOString().slice(0, 16);
  }

  export function openEditor(): void {
    if (readOnly) return;
    if (remaining !== null && remaining > 0) {
      const best = bestUnit(Math.round(remaining / 1000) * 1000);
      input = String(best.value);
      unit = best.unit;
    } else {
      input = "";
      unit = "s";
    }
    at = "";
    error = null;
    open = true;
    void tick().then(() => field?.select());
  }

  async function apply(ms: number) {
    busy = true;
    error = null;
    const ok = await onapply(ms);
    busy = false;
    if (ok) open = false;
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    let ms: number | null;
    if (at) {
      const target = new Date(at).getTime();
      ms = Number.isFinite(target) ? target - Date.now() : null;
      if (ms !== null && ms <= 0) {
        error = t("editors.ttl.pastDate");
        return;
      }
    } else {
      ms = parseTtl(input, unit);
    }
    if (ms === null) {
      error = t("editors.ttl.invalid");
      return;
    }
    void apply(ms);
  }

  const preview = $derived.by(() => {
    if (at) {
      const target = new Date(at).getTime();
      return Number.isFinite(target) && target > Date.now() ? countdown(target - Date.now()) : null;
    }
    const ms = parseTtl(input, unit);
    return ms ? fmtDate(Date.now() + ms) : null;
  });
</script>

<button
  bind:this={chip}
  class="ttl"
  class:persistent={ttl === -1}
  class:soon={remaining !== null && remaining < 60_000}
  disabled={ttl === null}
  onclick={() => (open ? (open = false) : openEditor())}
  use:tooltip={remaining !== null ? t("editors.ttl.expiresAt", { date: fmtDate(expiresAt!) }) : readOnly ? t("editors.ttl.title") : t("editors.ttl.edit")}
>
  {#if ttl === -1}
    <InfinityIcon size={13} />
    <span>{t("common.ttl.persistent")}</span>
  {:else}
    <Hourglass size={12} />
    <span class="tabular">{remaining === null ? "…" : countdown(remaining)}</span>
  {/if}
</button>

{#if open && chip}
  <Popover anchor={chip} onclose={() => (open = false)} width={300}>
    <form class="pop" onsubmit={submit}>
      <div class="title">{t("editors.ttl.title")}</div>
      <p class="current">
        {#if remaining !== null}
          {t("editors.ttl.current", { left: countdown(remaining) })} · {fmtDate(expiresAt!)}
        {:else}
          {t("editors.ttl.none")}
        {/if}
      </p>

      <div class="field">
        <label for="ttl-input">{t("editors.ttl.duration")}</label>
        <div class="row">
          <input
            id="ttl-input"
            bind:this={field}
            class="input sm"
            class:invalid={!!error && !at}
            bind:value={input}
            placeholder={t("editors.ttl.placeholder")}
            autocomplete="off"
            spellcheck="false"
            oninput={() => {
              at = "";
              error = null;
            }}
          />
          <select class="select sm unit" bind:value={unit} aria-label={t("editors.ttl.unit")}>
            {#each units as u (u)}<option value={u}>{t(`editors.ttl.units.${u}`)}</option>{/each}
          </select>
        </div>
      </div>

      <div class="presets">
        {#each presets as preset (preset.ms)}
          <button type="button" class="btn sm" disabled={busy} onclick={() => apply(preset.ms)}>{preset.label()}</button>
        {/each}
      </div>

      <div class="field">
        <label for="ttl-at">{t("editors.ttl.at")}</label>
        <input
          id="ttl-at"
          type="datetime-local"
          class="input sm"
          class:invalid={!!error && !!at}
          bind:value={at}
          min={localInput(Date.now())}
          oninput={() => (error = null)}
        />
      </div>

      {#if error}<div class="error-text">{error}</div>{:else if preview}<div class="hint">{at ? t("editors.ttl.in", { left: preview }) : t("editors.ttl.until", { date: preview })}</div>{/if}

      <div class="actions">
        {#if ttl !== -1}
          <button type="button" class="btn ghost sm" disabled={busy} onclick={() => apply(-1)}>
            <InfinityIcon size={13} />
            {t("editors.ttl.persist")}
          </button>
        {/if}
        <span class="grow"></span>
        <button type="button" class="btn sm" onclick={() => (open = false)}>{t("common.cancel")}</button>
        <button type="submit" class="btn primary sm" disabled={busy}>{t("common.apply")}</button>
      </div>
    </form>
  </Popover>
{/if}

<style>
  .ttl {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 20px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg-sunken);
    color: var(--text-2);
    font-size: var(--fs-xs);
    cursor: pointer;
    white-space: nowrap;
  }

  .ttl:hover:not(:disabled) {
    border-color: var(--border-strong);
    color: var(--text);
  }

  .ttl:disabled {
    cursor: default;
  }

  .persistent {
    color: var(--text-3);
  }

  .soon {
    border-color: color-mix(in srgb, var(--warning) 40%, transparent);
    background: var(--warning-soft);
    color: var(--warning);
  }

  .pop {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
  }

  .title {
    font-weight: 600;
  }

  .current {
    margin-top: -6px;
    color: var(--text-3);
    font-size: var(--fs-sm);
  }

  .unit {
    width: 96px;
    flex: none;
  }

  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 2px;
  }
</style>
