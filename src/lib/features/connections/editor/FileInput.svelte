<script lang="ts">
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import { t } from "$lib/i18n/index.svelte";
  import { toastError } from "$lib/state/toasts.svelte";
  import { tooltip } from "$lib/ui/tooltip.svelte";
  import { pickFile, type FileFilter } from "../files";

  interface Props {
    value: string;
    id: string;
    /** Dosya penceresinin başlığı */
    title: string;
    filters?: FileFilter[];
    placeholder?: string;
    invalid?: boolean;
  }

  let { value = $bindable(), id, title, filters, placeholder = "", invalid = false }: Props = $props();

  async function browse() {
    try {
      const picked = await pickFile({ title, filters, current: value });
      if (picked) value = picked;
    } catch (err) {
      toastError(err);
    }
  }
</script>

<div class="file">
  <input {id} class="input mono" class:invalid bind:value {placeholder} spellcheck="false" autocomplete="off" />
  <button type="button" class="btn" aria-label={t("common.browse")} use:tooltip={title} onclick={browse}>
    <FolderOpen size={14} />{t("common.browse")}
  </button>
</div>

<style>
  .file {
    display: flex;
    gap: 6px;
  }

  .input {
    flex: 1;
    min-width: 0;
  }

  .btn {
    flex: none;
  }
</style>
