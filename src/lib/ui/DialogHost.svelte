<script lang="ts">
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import { t } from "$lib/i18n/index.svelte";
  import { dialogQueue, type DialogRequest } from "$lib/state/dialogs.svelte";
  import Modal from "./Modal.svelte";

  const current = $derived(dialogQueue[0] as DialogRequest | undefined);

  let typed = $state("");
  let value = $state("");

  $effect(() => {
    if (current?.kind === "prompt") value = current.options.value ?? "";
    typed = "";
  });

  const promptError = $derived(current?.kind === "prompt" ? (current.options.validate?.(value) ?? null) : null);
  const confirmBlocked = $derived(current?.kind === "confirm" && !!current.options.requireText && typed.trim() !== current.options.requireText);

  function finish(result: boolean) {
    const request = dialogQueue.shift();
    if (!request) return;
    if (request.kind === "confirm") request.resolve(result);
    else request.resolve(result ? value : null);
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (current?.kind === "confirm" && !confirmBlocked) finish(true);
    if (current?.kind === "prompt" && !promptError) finish(true);
  }
</script>

{#if current}
  {#key current}
    <Modal title={current.options.title} size="sm" onclose={() => finish(false)}>
      {#snippet icon()}
        {#if current.kind === "confirm" && current.options.danger}
          <span class="danger-icon"><TriangleAlert size={18} /></span>
        {/if}
      {/snippet}
      <form id="dialog-form" onsubmit={submit}>
        {#if current.options.message}<p class="message">{current.options.message}</p>{/if}
        {#if current.kind === "confirm"}
          {#if current.options.details?.length}
            <ul class="details selectable">
              {#each current.options.details as line, i (i)}<li class="mono truncate">{line}</li>{/each}
            </ul>
          {/if}
          {#if current.options.requireText}
            <div class="field require">
              <label for="dialog-require">{t("common.typeToConfirm", { text: current.options.requireText })}</label>
              <input id="dialog-require" class="input mono" bind:value={typed} autocomplete="off" spellcheck="false" data-autofocus />
            </div>
          {/if}
        {:else}
          <div class="field">
            {#if current.options.label}<label for="dialog-prompt">{current.options.label}</label>{/if}
            <input
              id="dialog-prompt"
              class="input"
              class:mono={current.options.mono}
              class:invalid={!!promptError && value !== (current.options.value ?? "")}
              bind:value
              placeholder={current.options.placeholder}
              spellcheck="false"
              autocomplete="off"
              data-autofocus
            />
            {#if promptError && value !== (current.options.value ?? "")}<span class="error-text">{promptError}</span>{/if}
          </div>
        {/if}
      </form>
      {#snippet footer()}
        <button class="btn" onclick={() => finish(false)}>{current.kind === "confirm" ? (current.options.cancelLabel ?? t("common.cancel")) : t("common.cancel")}</button>
        <button
          class="btn"
          class:primary={!(current.kind === "confirm" && current.options.danger)}
          class:danger={current.kind === "confirm" && current.options.danger}
          type="submit"
          form="dialog-form"
          disabled={current.kind === "confirm" ? confirmBlocked : !!promptError}
        >
          {current.options.confirmLabel ?? t("common.ok")}
        </button>
      {/snippet}
    </Modal>
  {/key}
{/if}

<style>
  .message {
    color: var(--text-2);
    line-height: 1.55;
    white-space: pre-line;
  }

  .details {
    margin: 10px 0 0;
    padding: 8px 10px;
    list-style: none;
    max-height: 140px;
    overflow: auto;
    background: var(--bg-sunken);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius);
  }

  .details li {
    line-height: 1.7;
  }

  .field {
    margin-top: 12px;
  }

  .danger-icon {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--danger-soft);
    color: var(--danger);
  }
</style>
