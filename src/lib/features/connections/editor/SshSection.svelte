<script lang="ts">
  import Info from "@lucide/svelte/icons/info";
  import type { ConnectionConfig, SshAuth } from "$lib/api/types";
  import { t } from "$lib/i18n/index.svelte";
  import Segmented from "$lib/ui/Segmented.svelte";
  import Switch from "$lib/ui/Switch.svelte";
  import type { FileFilter } from "../files";
  import FileInput from "./FileInput.svelte";
  import PasswordInput from "./PasswordInput.svelte";
  import type { Field } from "./validate";

  interface Props {
    form: ConnectionConfig;
    err: (field: Field) => string | null;
    touch: (field: Field) => void;
  }

  let { form = $bindable(), err, touch }: Props = $props();

  const auths = $derived([
    { value: "password" as SshAuth, label: t("connections.editor.ssh.auths.password") },
    { value: "privateKey" as SshAuth, label: t("connections.editor.ssh.auths.privateKey") },
    { value: "agent" as SshAuth, label: t("connections.editor.ssh.auths.agent") },
  ]);

  const filters = $derived<FileFilter[]>([
    { name: t("connections.editor.keyFiles"), extensions: ["pem", "key", "ppk", "openssh"] },
    { name: t("connections.editor.allFiles"), extensions: ["*"] },
  ]);
</script>

<div class="section">
  <Switch bind:checked={form.ssh.enabled}>{t("connections.editor.ssh.enable")}</Switch>

  {#if form.ssh.enabled}
    <div class="grid">
      <div class="field span-2">
        <label for="ce-sshHost">{t("connections.editor.ssh.host")}</label>
        <input id="ce-sshHost" class="input" class:invalid={!!err("sshHost")} bind:value={form.ssh.host} onblur={() => touch("sshHost")} placeholder="bastion.example.com" spellcheck="false" autocomplete="off" />
        {#if err("sshHost")}<span class="error-text">{err("sshHost")}</span>{/if}
      </div>
      <div class="field">
        <label for="ce-sshPort">{t("connections.editor.ssh.port")}</label>
        <input id="ce-sshPort" class="input tabular" class:invalid={!!err("sshPort")} type="number" min="1" max="65535" bind:value={form.ssh.port} onblur={() => touch("sshPort")} />
        {#if err("sshPort")}<span class="error-text">{err("sshPort")}</span>{/if}
      </div>

      <div class="field span-2">
        <label for="ce-sshUser">{t("connections.editor.ssh.username")}</label>
        <input id="ce-sshUser" class="input" class:invalid={!!err("sshUser")} bind:value={form.ssh.username} onblur={() => touch("sshUser")} placeholder="ubuntu" spellcheck="false" autocomplete="off" />
        {#if err("sshUser")}<span class="error-text">{err("sshUser")}</span>{/if}
      </div>
      <div class="field">
        <label for="ce-sshTimeout">{t("connections.editor.ssh.timeout")}</label>
        <input id="ce-sshTimeout" class="input tabular" class:invalid={!!err("sshTimeout")} type="number" min="1" max="300" bind:value={form.ssh.timeoutSec} onblur={() => touch("sshTimeout")} />
        {#if err("sshTimeout")}<span class="error-text">{err("sshTimeout")}</span>{/if}
      </div>

      <div class="field span-3">
        <span class="label">{t("connections.editor.ssh.auth")}</span>
        <div><Segmented options={auths} bind:value={form.ssh.auth} /></div>
      </div>

      {#if form.ssh.auth === "password"}
        <div class="field span-2">
          <label for="ce-sshPassword">{t("connections.editor.password")}</label>
          <PasswordInput id="ce-sshPassword" bind:value={form.ssh.password} />
        </div>
      {:else if form.ssh.auth === "privateKey"}
        <div class="field span-3">
          <label for="ce-sshKey">{t("connections.editor.ssh.keyFile")}</label>
          <FileInput id="ce-sshKey" bind:value={form.ssh.privateKeyPath} title={t("connections.editor.ssh.keyFile")} {filters} placeholder="~/.ssh/id_ed25519" invalid={!!err("sshKey")} />
          {#if err("sshKey")}<span class="error-text">{err("sshKey")}</span>{/if}
        </div>
        <div class="field span-2">
          <label for="ce-sshPassphrase">{t("connections.editor.ssh.passphrase")}</label>
          <PasswordInput id="ce-sshPassphrase" bind:value={form.ssh.passphrase} placeholder={t("common.optional")} />
        </div>
      {:else}
        <p class="hint span-3">{t("connections.editor.ssh.agentHint")}</p>
      {/if}

      <p class="note span-3"><Info size={13} /><span>{t("connections.editor.ssh.hint")}</span></p>
    </div>
  {:else}
    <p class="off">{t("connections.editor.ssh.off")}</p>
  {/if}
</div>

<style>
  .section {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

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

  input[type="number"]::-webkit-inner-spin-button,
  input[type="number"]::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  .hint {
    line-height: 1.5;
  }

  .note {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 10px;
    border-radius: var(--radius);
    background: var(--bg-sunken);
    color: var(--text-2);
    font-size: var(--fs-sm);
    line-height: 1.5;
  }

  .note :global(svg) {
    flex: none;
    margin-top: 2px;
    color: var(--text-3);
  }

  .off {
    max-width: 440px;
    color: var(--text-3);
    font-size: var(--fs-sm);
    line-height: 1.55;
  }
</style>
