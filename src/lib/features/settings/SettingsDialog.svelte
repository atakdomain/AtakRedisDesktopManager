<script lang="ts">
  import Copy from "@lucide/svelte/icons/copy";
  import Download from "@lucide/svelte/icons/download";
  import Monitor from "@lucide/svelte/icons/monitor";
  import Moon from "@lucide/svelte/icons/moon";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import Sun from "@lucide/svelte/icons/sun";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import { onMount } from "svelte";
  import { api } from "$lib/api";
  import type { AppInfo, SearchMode } from "$lib/api/types";
  import { fmtNumber, t, type Locale } from "$lib/i18n/index.svelte";
  import { settings, type Theme } from "$lib/state/settings.svelte";
  import { toast, toastError } from "$lib/state/toasts.svelte";
  import { ui } from "$lib/state/ui.svelte";
  import Modal from "$lib/ui/Modal.svelte";
  import Segmented from "$lib/ui/Segmented.svelte";
  import Switch from "$lib/ui/Switch.svelte";
  import { tooltip } from "$lib/ui/tooltip.svelte";
  import { copyText } from "$lib/util/clipboard";

  let info = $state<AppInfo | null>(null);

  onMount(() => {
    api.app
      .info()
      .then((value) => (info = value))
      .catch(() => undefined);
  });

  const themes = $derived([
    { value: "system" as Theme, label: t("common.theme.system"), icon: Monitor },
    { value: "light" as Theme, label: t("common.theme.light"), icon: Sun },
    { value: "dark" as Theme, label: t("common.theme.dark"), icon: Moon },
  ]);

  const locales = $derived([
    { value: "tr" as Locale, label: t("settings.languages.tr") },
    { value: "en" as Locale, label: t("settings.languages.en") },
  ]);

  const fontSizes = [12, 13, 14, 15, 16].map((size) => ({ value: size, label: String(size) }));
  const scanLimits = $derived([5000, 10000, 25000, 50000].map((value) => ({ value, label: fmtNumber(value) })));
  const searchModes: SearchMode[] = ["contains", "prefix", "exact", "glob", "regex"];

  const platformNames: Record<AppInfo["platform"], string> = { windows: "Windows", linux: "Linux", macos: "macOS" };

  function close() {
    ui.settingsOpen = false;
  }

  function reimport() {
    ui.settingsOpen = false;
    ui.importOpen = true;
  }

  async function copyConfigDir() {
    if (!info) return;
    try {
      await copyText(info.configDir);
      toast("success", t("common.copied"));
    } catch (err) {
      toastError(err);
    }
  }
</script>

<Modal title={t("settings.title")} subtitle={t("settings.liveHint")} size="md" onclose={close}>
  <section>
    <h3>{t("settings.sections.appearance")}</h3>
    <div class="row">
      <div class="text"><div class="label">{t("settings.theme")}</div></div>
      <Segmented size="sm" options={themes} bind:value={settings.theme} />
    </div>
    <div class="row">
      <div class="text"><div class="label">{t("settings.language")}</div></div>
      <Segmented size="sm" options={locales} bind:value={settings.locale} />
    </div>
    <div class="row">
      <div class="text">
        <div class="label">{t("settings.fontSize")}</div>
        <div class="hint">{t("settings.fontSizeHint")}</div>
      </div>
      <Segmented size="sm" options={fontSizes} bind:value={settings.fontSize} />
    </div>
  </section>

  <section>
    <h3>{t("settings.sections.keys")}</h3>
    <div class="row">
      <div class="text">
        <label class="label" for="settings-search-mode">{t("settings.searchMode")}</label>
        <div class="hint">{t("settings.searchModeHint")}</div>
      </div>
      <select id="settings-search-mode" class="select sm mode" bind:value={settings.searchMode}>
        {#each searchModes as mode (mode)}<option value={mode}>{t(`settings.searchModes.${mode}`)}</option>{/each}
      </select>
    </div>
    <div class="row">
      <div class="text">
        <div class="label">{t("settings.caseSensitive")}</div>
        <div class="hint">{t("settings.caseSensitiveHint")}</div>
      </div>
      <Switch bind:checked={settings.caseSensitive} />
    </div>
    <div class="row">
      <div class="text">
        <div class="label">{t("settings.scanLimit")}</div>
        <div class="hint">{t("settings.scanLimitHint")}</div>
      </div>
      <Segmented size="sm" options={scanLimits} bind:value={settings.scanLimit} />
    </div>
    <div class="row">
      <div class="text">
        <div class="label">{t("settings.treeView")}</div>
        <div class="hint">{t("settings.treeViewHint")}</div>
      </div>
      <Switch bind:checked={settings.treeView} />
    </div>
    <div class="row">
      <div class="text">
        <div class="label">{t("settings.showKeyMeta")}</div>
        <div class="hint">{t("settings.showKeyMetaHint")}</div>
      </div>
      <Switch bind:checked={settings.showKeyMeta} />
    </div>
  </section>

  <section>
    <h3>{t("settings.sections.editor")}</h3>
    <div class="row">
      <div class="text">
        <div class="label">{t("settings.confirmDangerous")}</div>
        <div class="hint">{t("settings.confirmDangerousHint")}</div>
      </div>
      <Switch bind:checked={settings.confirmDangerous} />
    </div>
    <div class="row">
      <div class="text">
        <div class="label">{t("settings.wordWrap")}</div>
        <div class="hint">{t("settings.wordWrapHint")}</div>
      </div>
      <Switch bind:checked={settings.wordWrap} />
    </div>
  </section>

  <section>
    <h3>{t("settings.sections.import")}</h3>
    <div class="row">
      <div class="text">
        <div class="label">{t("settings.reimport")}</div>
        <div class="hint">{t("settings.reimportHint")}</div>
      </div>
      <button class="btn sm" onclick={reimport}><Download size={13} />{t("settings.reimportButton")}</button>
    </div>
  </section>

  <section>
    <h3>{t("settings.sections.about")}</h3>
    <dl class="about">
      <dt>{t("settings.about.version")}</dt>
      <dd class="selectable">{info?.version ?? "…"}</dd>
      <dt>{t("settings.about.platform")}</dt>
      <dd>{info ? platformNames[info.platform] : "…"}</dd>
      <dt>{t("settings.about.configDir")}</dt>
      <dd class="path">
        <span class="mono truncate selectable" use:tooltip={info?.configDir}>{info?.configDir ?? "…"}</span>
        {#if info}
          <button class="btn ghost icon sm" aria-label={t("settings.about.copyPath")} use:tooltip={t("settings.about.copyPath")} onclick={copyConfigDir}><Copy size={13} /></button>
        {/if}
      </dd>
      <dt>{t("settings.about.passwords")}</dt>
      <dd>
        {#if info}
          {#if info.secureStorage}
            <span class="secure ok"><ShieldCheck size={13} />{t("settings.about.keychain")}</span>
          {:else}
            <span class="secure warn"><TriangleAlert size={13} />{t("settings.about.file")}</span>
          {/if}
        {:else}…{/if}
      </dd>
    </dl>
  </section>
</Modal>

<style>
  section {
    padding: 4px 0 12px;
  }

  section + section {
    padding-top: 14px;
    border-top: 1px solid var(--border-subtle);
  }

  h3 {
    margin-bottom: 4px;
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-3);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 16px;
    min-height: 44px;
    padding: 6px 0;
  }

  .text {
    flex: 1;
    min-width: 0;
  }

  .label {
    font-size: var(--fs);
    font-weight: 500;
    color: var(--text);
  }

  .hint {
    margin-top: 1px;
    line-height: 1.45;
  }

  .mode {
    width: 170px;
    flex: none;
  }

  .about {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 8px 16px;
    margin: 8px 0 0;
    font-size: var(--fs);
  }

  dt {
    color: var(--text-3);
  }

  dd {
    margin: 0;
    min-width: 0;
  }

  .path {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: -4px;
    margin-bottom: -4px;
  }

  .secure {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .secure.ok {
    color: var(--success);
  }

  .secure.warn {
    color: var(--warning);
  }
</style>
