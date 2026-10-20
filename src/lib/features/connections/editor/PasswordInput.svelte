<script lang="ts">
  import Eye from "@lucide/svelte/icons/eye";
  import EyeOff from "@lucide/svelte/icons/eye-off";
  import { t } from "$lib/i18n/index.svelte";
  import { tooltip } from "$lib/ui/tooltip.svelte";

  let { value = $bindable(), id, placeholder = "" }: { value: string; id: string; placeholder?: string } = $props();

  let visible = $state(false);
  const label = $derived(visible ? t("connections.editor.hidePassword") : t("connections.editor.showPassword"));
</script>

<div class="password">
  <input {id} class="input" type={visible ? "text" : "password"} bind:value {placeholder} autocomplete="off" spellcheck="false" />
  <button type="button" class="toggle" aria-label={label} aria-pressed={visible} use:tooltip={label} onclick={() => (visible = !visible)}>
    {#if visible}<EyeOff size={14} />{:else}<Eye size={14} />{/if}
  </button>
</div>

<style>
  .password {
    position: relative;
    display: flex;
  }

  .input {
    padding-right: 32px;
  }

  .toggle {
    position: absolute;
    top: 3px;
    right: 3px;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-3);
    cursor: pointer;
  }

  .toggle:hover {
    background: var(--bg-hover);
    color: var(--text);
  }
</style>
