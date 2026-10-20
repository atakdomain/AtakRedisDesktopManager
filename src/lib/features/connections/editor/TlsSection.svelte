<script lang="ts">
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import type { ConnectionConfig } from "$lib/api/types";
  import { t } from "$lib/i18n/index.svelte";
  import Switch from "$lib/ui/Switch.svelte";
  import type { FileFilter } from "../files";
  import FileInput from "./FileInput.svelte";

  let { form = $bindable() }: { form: ConnectionConfig } = $props();

  const filters = $derived<FileFilter[]>([
    { name: t("connections.editor.pemFiles"), extensions: ["pem", "crt", "cer", "key"] },
    { name: t("connections.editor.allFiles"), extensions: ["*"] },
  ]);
</script>

<div class="section">
  <Switch bind:checked={form.tls.enabled}>{t("connections.editor.tls.enable")}</Switch>

  {#if form.tls.enabled}
    <div class="fields">
      <div class="field">
        <label for="ce-tls-ca">{t("connections.editor.tls.ca")}</label>
        <FileInput id="ce-tls-ca" bind:value={form.tls.caPath} title={t("connections.editor.tls.ca")} {filters} placeholder={t("common.optional")} />
      </div>
      <div class="pair">
        <div class="field">
          <label for="ce-tls-cert">{t("connections.editor.tls.cert")}</label>
          <FileInput id="ce-tls-cert" bind:value={form.tls.certPath} title={t("connections.editor.tls.cert")} {filters} placeholder={t("common.optional")} />
        </div>
        <div class="field">
          <label for="ce-tls-key">{t("connections.editor.tls.key")}</label>
          <FileInput id="ce-tls-key" bind:value={form.tls.keyPath} title={t("connections.editor.tls.key")} {filters} placeholder={t("common.optional")} />
        </div>
      </div>
      <p class="hint">{t("connections.editor.tls.pemHint")}</p>
      <div class="field">
        <label for="ce-tls-sni">{t("connections.editor.tls.serverName")}</label>
        <input id="ce-tls-sni" class="input" bind:value={form.tls.serverName} placeholder={form.host || t("connections.editor.tls.serverNamePlaceholder")} spellcheck="false" autocomplete="off" />
      </div>
      <div class="skip">
        <Switch bind:checked={form.tls.skipVerify}>{t("connections.editor.tls.skipVerify")}</Switch>
        {#if form.tls.skipVerify}
          <div class="warn">
            <TriangleAlert size={14} />
            <span>{t("connections.editor.tls.skipVerifyWarning")}</span>
          </div>
        {/if}
      </div>
    </div>
  {:else}
    <p class="off">{t("connections.editor.tls.off")}</p>
  {/if}
</div>

<style>
  .section {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .fields {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .hint {
    margin-top: -6px;
    line-height: 1.5;
  }

  .off {
    max-width: 440px;
    color: var(--text-3);
    font-size: var(--fs-sm);
    line-height: 1.55;
  }

  .skip {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .warn {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 10px;
    border-radius: var(--radius);
    background: var(--warning-soft);
    color: var(--warning);
    font-size: var(--fs-sm);
    line-height: 1.5;
  }

  .warn :global(svg) {
    flex: none;
    margin-top: 2px;
  }
</style>
