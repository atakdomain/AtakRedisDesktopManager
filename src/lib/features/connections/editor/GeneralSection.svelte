<script lang="ts">
  import Ban from "@lucide/svelte/icons/ban";
  import Check from "@lucide/svelte/icons/check";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import type { ConnectionConfig, ConnectionMode } from "$lib/api/types";
  import { t } from "$lib/i18n/index.svelte";
  import { connections } from "$lib/state/connections.svelte";
  import Segmented from "$lib/ui/Segmented.svelte";
  import Switch from "$lib/ui/Switch.svelte";
  import { tooltip } from "$lib/ui/tooltip.svelte";
  import { address, ENV_TAGS, envColor, SWATCHES } from "../connectionInfo";
  import PasswordInput from "./PasswordInput.svelte";
  import type { Field } from "./validate";

  interface Props {
    form: ConnectionConfig;
    err: (field: Field) => string | null;
    touch: (field: Field) => void;
    autofocusName: boolean;
  }

  let { form = $bindable(), err, touch, autofocusName }: Props = $props();

  const modes = $derived([
    { value: "standalone" as ConnectionMode, label: t("connections.modes.standalone") },
    { value: "cluster" as ConnectionMode, label: t("connections.modes.cluster") },
    { value: "sentinel" as ConnectionMode, label: t("connections.modes.sentinel") },
  ]);

  function onModeChange(mode: ConnectionMode) {
    // Sentinel'in varsayılan portu 26379
    if (mode === "sentinel" && form.port === 6379) form.port = 26379;
    else if (mode !== "sentinel" && form.port === 26379) form.port = 6379;
  }

  const sentinel = $derived(form.mode === "sentinel");
</script>

<div class="grid">
  <div class="field span-3">
    <label for="ce-name">{t("connections.editor.name")}</label>
    <input id="ce-name" class="input" bind:value={form.name} placeholder={address(form)} spellcheck="false" autocomplete="off" data-autofocus={autofocusName || undefined} />
  </div>

  <div class="field span-3">
    <span class="label">{t("connections.editor.mode")}</span>
    <div><Segmented options={modes} bind:value={form.mode} onchange={onModeChange} /></div>
  </div>

  <div class="field span-2">
    <label for="ce-host">{sentinel ? t("connections.editor.sentinelHost") : t("connections.editor.host")}</label>
    <input id="ce-host" class="input" class:invalid={!!err("host")} bind:value={form.host} onblur={() => touch("host")} spellcheck="false" autocomplete="off" placeholder="127.0.0.1" />
    {#if err("host")}<span class="error-text">{err("host")}</span>{/if}
  </div>
  <div class="field">
    <label for="ce-port">{sentinel ? t("connections.editor.sentinelPort") : t("connections.editor.port")}</label>
    <input id="ce-port" class="input tabular" class:invalid={!!err("port")} type="number" min="1" max="65535" bind:value={form.port} onblur={() => touch("port")} />
    {#if err("port")}<span class="error-text">{err("port")}</span>{/if}
  </div>

  {#if sentinel}
    <p class="hint span-3 tight">{t("connections.editor.sentinelHint")}</p>
    <div class="field">
      <label for="ce-masterName">{t("connections.editor.masterName")}</label>
      <input id="ce-masterName" class="input" class:invalid={!!err("masterName")} bind:value={form.sentinel.masterName} onblur={() => touch("masterName")} spellcheck="false" autocomplete="off" />
      {#if err("masterName")}<span class="error-text">{err("masterName")}</span>{/if}
    </div>
    <div class="field">
      <label for="ce-sentinelUsername">{t("connections.editor.sentinelUsername")}</label>
      <input id="ce-sentinelUsername" class="input" bind:value={form.sentinel.sentinelUsername} placeholder={t("common.optional")} spellcheck="false" autocomplete="off" />
    </div>
    <div class="field">
      <label for="ce-sentinelPassword">{t("connections.editor.sentinelPassword")}</label>
      <PasswordInput id="ce-sentinelPassword" bind:value={form.sentinel.sentinelPassword} placeholder={t("common.optional")} />
    </div>
  {/if}

  <div class="field">
    <label for="ce-username">{t("connections.editor.username")}</label>
    <input id="ce-username" class="input" bind:value={form.username} placeholder="default" spellcheck="false" autocomplete="off" />
  </div>
  <div class="field span-2">
    <label for="ce-password">{t("connections.editor.password")}</label>
    <PasswordInput id="ce-password" bind:value={form.password} placeholder={t("common.optional")} />
  </div>

  <div class="field">
    <label for="ce-db">{t("connections.editor.db")}</label>
    {#if form.mode === "cluster"}
      <input id="ce-db" class="input" value="0" disabled use:tooltip={t("connections.editor.clusterDbHint")} />
    {:else}
      <input id="ce-db" class="input tabular" class:invalid={!!err("db")} type="number" min="0" bind:value={form.db} onblur={() => touch("db")} />
    {/if}
    {#if err("db")}<span class="error-text">{err("db")}</span>{/if}
  </div>
  <div class="field">
    <label for="ce-separator">{t("connections.editor.separator")}</label>
    <input id="ce-separator" class="input mono" bind:value={form.separator} maxlength="4" spellcheck="false" autocomplete="off" use:tooltip={t("connections.editor.separatorHint")} />
  </div>
  <div class="field">
    <label for="ce-timeoutSec">{t("connections.editor.timeout")}</label>
    <input id="ce-timeoutSec" class="input tabular" class:invalid={!!err("timeoutSec")} type="number" min="1" max="300" bind:value={form.timeoutSec} onblur={() => touch("timeoutSec")} />
    {#if err("timeoutSec")}<span class="error-text">{err("timeoutSec")}</span>{/if}
  </div>

  <div class="heading span-3">{t("connections.editor.organize")}</div>

  <div class="field">
    <label for="ce-env">{t("connections.editor.env")}</label>
    <div class="env" style:--tone={envColor(form.env) ?? "transparent"} class:none={form.env === "none"}>
      <span class="env-dot"></span>
      <select id="ce-env" class="select" bind:value={form.env}>
        {#each ENV_TAGS as env (env)}
          <option value={env}>{t(`common.env.${env}`)}</option>
        {/each}
      </select>
    </div>
  </div>
  <div class="field span-2">
    <label for="ce-group">{t("connections.editor.group")}</label>
    <input id="ce-group" class="input" list="ce-groups" bind:value={form.group} placeholder={t("connections.editor.groupPlaceholder")} spellcheck="false" autocomplete="off" />
    <datalist id="ce-groups">
      {#each connections.groups as group (group)}<option value={group}></option>{/each}
    </datalist>
  </div>

  {#if form.env === "production"}
    <div class="warn span-3">
      <TriangleAlert size={14} />
      <span>{t("connections.editor.productionWarning")}</span>
    </div>
  {/if}

  <div class="field span-3">
    <span class="label">{t("connections.editor.color")}</span>
    <div class="swatches" role="radiogroup" aria-label={t("connections.editor.color")}>
      <button type="button" class="swatch none" role="radio" aria-checked={form.color === ""} aria-label={t("connections.editor.noColor")} use:tooltip={t("connections.editor.noColor")} onclick={() => (form.color = "")}>
        <Ban size={14} />
      </button>
      {#each SWATCHES as color (color)}
        <button type="button" class="swatch" role="radio" aria-checked={form.color === color} aria-label={color} style:--swatch={color} onclick={() => (form.color = color)}>
          {#if form.color === color}<Check size={12} strokeWidth={3} />{/if}
        </button>
      {/each}
    </div>
  </div>

  <div class="span-3 readonly">
    <Switch bind:checked={form.readOnly}>{t("connections.editor.readOnly")}</Switch>
    <p class="hint">{t("connections.editor.readOnlyHint")}</p>
  </div>
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 14px 12px;
  }

  .span-2 {
    grid-column: span 2;
  }

  .span-3 {
    grid-column: span 3;
  }

  .tight {
    margin-top: -8px;
  }

  .heading {
    margin-top: 6px;
    padding-top: 14px;
    border-top: 1px solid var(--border-subtle);
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-3);
  }

  input[type="number"]::-webkit-inner-spin-button,
  input[type="number"]::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  .input:disabled {
    color: var(--text-3);
    background: var(--bg-sunken);
  }

  .env {
    position: relative;
  }

  .env-dot {
    position: absolute;
    top: 50%;
    left: 10px;
    width: 9px;
    height: 9px;
    margin-top: -4.5px;
    border-radius: 50%;
    background: var(--tone);
    pointer-events: none;
  }

  .env.none .env-dot {
    border: 1.5px dashed var(--border-strong);
  }

  .env .select {
    padding-left: 27px;
  }

  .warn {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-top: -4px;
    padding: 8px 10px;
    border-radius: var(--radius);
    background: var(--danger-soft);
    color: var(--danger);
    font-size: var(--fs-sm);
    line-height: 1.5;
  }

  .warn :global(svg) {
    flex: none;
    margin-top: 2px;
  }

  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .swatch {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--swatch);
    color: #fff;
    cursor: pointer;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
    transition: transform var(--dur) var(--ease);
  }

  .swatch:hover {
    transform: scale(1.1);
  }

  .swatch[aria-checked="true"] {
    box-shadow:
      0 0 0 2px var(--bg-elevated),
      0 0 0 4px var(--swatch, var(--border-strong));
  }

  .swatch.none {
    background: var(--bg-sunken);
    color: var(--text-3);
    box-shadow: inset 0 0 0 1px var(--border-strong);
  }

  .swatch.none[aria-checked="true"] {
    box-shadow:
      inset 0 0 0 1px var(--border-strong),
      0 0 0 2px var(--bg-elevated),
      0 0 0 4px var(--text-3);
  }

  .readonly {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .readonly .hint {
    padding-left: 40px;
    line-height: 1.5;
  }
</style>
