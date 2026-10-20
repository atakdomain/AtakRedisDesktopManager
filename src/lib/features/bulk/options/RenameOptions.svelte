<script lang="ts">
  import CaseSensitive from "@lucide/svelte/icons/case-sensitive";
  import Regex from "@lucide/svelte/icons/regex";
  import { t } from "$lib/i18n/index.svelte";
  import Segmented from "$lib/ui/Segmented.svelte";
  import { tooltip } from "$lib/ui/tooltip.svelte";
  import type { BulkFlow } from "../flow.svelte";
  import type { RenameMode } from "../model/draft";
  import { regexError } from "../model/patterns";

  let { flow }: { flow: BulkFlow } = $props();

  const draft = $derived(flow.draft);
  const modes = $derived<{ value: RenameMode; label: string }[]>([
    { value: "prefix", label: t("bulk.options.renamePrefix") },
    { value: "replace", label: t("bulk.options.renameReplace") },
  ]);
  /** Diyalog ilk alana odaklanır; asıl düzenlenecek alana geç, imleç sonda */
  function focusEnd(node: HTMLInputElement): void {
    queueMicrotask(() => {
      node.focus();
      node.setSelectionRange(node.value.length, node.value.length);
    });
  }

  const findError = $derived(draft.renameMode === "replace" && draft.regex ? regexError(draft.find) : null);
</script>

<div class="options">
  <Segmented options={modes} bind:value={flow.draft.renameMode} size="sm" />

  {#if draft.renameMode === "prefix"}
    <div class="field">
      <label for="bulk-old-prefix">{t("bulk.options.oldPrefix")}</label>
      <input id="bulk-old-prefix" class="input mono" spellcheck="false" autocomplete="off" bind:value={flow.draft.oldPrefix} />
    </div>
    <div class="field">
      <label for="bulk-new-prefix">{t("bulk.options.newPrefix")}</label>
      <input id="bulk-new-prefix" class="input mono" spellcheck="false" autocomplete="off" bind:value={flow.draft.newPrefix} use:focusEnd />
      <span class="hint">{t("bulk.options.prefixHint")}</span>
    </div>
  {:else}
    <div class="field">
      <label for="bulk-find">{t("bulk.options.find")}</label>
      <div class="box" class:invalid={!!findError}>
        <input id="bulk-find" class="field-input mono" spellcheck="false" autocomplete="off" bind:value={flow.draft.find} use:focusEnd />
        <button
          class="toggle"
          class:on={draft.caseSensitive}
          aria-pressed={draft.caseSensitive}
          aria-label={t("browser.search.chipCase")}
          use:tooltip={draft.caseSensitive ? t("browser.search.caseOn") : t("browser.search.caseOff")}
          onclick={() => (flow.draft.caseSensitive = !draft.caseSensitive)}><CaseSensitive size={15} /></button
        >
        <button
          class="toggle"
          class:on={draft.regex}
          aria-pressed={draft.regex}
          aria-label={t("browser.search.regex")}
          use:tooltip={t("browser.search.regex")}
          onclick={() => (flow.draft.regex = !draft.regex)}><Regex size={14} /></button
        >
      </div>
      {#if findError}<span class="error-text">{t("bulk.errors.regexInvalid", { detail: findError })}</span>{/if}
    </div>
    <div class="field">
      <label for="bulk-replace">{t("bulk.options.replace")}</label>
      <input id="bulk-replace" class="input mono" spellcheck="false" autocomplete="off" bind:value={flow.draft.replace} />
      <span class="hint">{draft.regex ? t("bulk.options.replaceHint") : t("bulk.options.replaceHintPlain")}</span>
    </div>
  {/if}

  <label class="check">
    <input type="checkbox" bind:checked={flow.draft.overwrite} />
    <span>{t("bulk.options.overwrite")}</span>
  </label>
  <p class="hint indent">{t("bulk.options.overwriteHint")}</p>
</div>

<style>
  .options {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .box {
    display: flex;
    align-items: center;
    gap: 2px;
    height: var(--h-control);
    padding: 0 3px 0 0;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--bg-input);
  }

  .box:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .box.invalid {
    border-color: var(--danger);
    box-shadow: 0 0 0 3px var(--danger-soft);
  }

  .field-input {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0 9px;
    border: 0;
    background: none;
    color: var(--text);
    font-family: var(--font-mono);
    font-size: var(--fs-mono);
    outline: none;
  }

  .toggle {
    display: grid;
    place-items: center;
    flex: none;
    width: 22px;
    height: 20px;
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

  .toggle.on {
    background: var(--accent);
    color: #fff;
  }

  .indent {
    margin-top: -6px;
    padding-left: 23px;
  }
</style>
