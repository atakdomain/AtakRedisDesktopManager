<script lang="ts">
  // List/Set'e öğe ekleme: satır başına bir değer ya da tek (çok satırlı) değer. Mod+Enter gönderir.
  import { tick, type Snippet } from "svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { isMac } from "$lib/state/commands.svelte";
  import Modal from "$lib/ui/Modal.svelte";
  import Segmented from "$lib/ui/Segmented.svelte";
  import Spinner from "$lib/ui/Spinner.svelte";
  import { describeError } from "../messages";

  interface Props {
    title: string;
    /** Ek seçenekler (ör. baş/son) */
    options?: Snippet;
    onsubmit: (values: string[]) => Promise<void>;
    onclose: () => void;
  }

  let { title, options, onsubmit, onclose }: Props = $props();

  let mode = $state<"lines" | "single">("lines");
  let text = $state("");
  let skipEmpty = $state(true);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let area = $state<HTMLTextAreaElement>();

  // Modal belge sırasındaki ilk denetimi odaklar (onay kutusu); metin alanı öncelikli
  $effect(() => {
    const el = area;
    if (el) void tick().then(() => el.focus());
  });

  const values = $derived(mode === "single" ? [text] : text.split(/\r?\n/).filter((line) => !skipEmpty || line.length > 0));
  const valid = $derived(mode === "single" || values.length > 0);

  async function submit(e?: SubmitEvent) {
    e?.preventDefault();
    if (!valid || busy) return;
    busy = true;
    error = null;
    try {
      await onsubmit(values);
      onclose();
    } catch (err) {
      error = describeError(err);
    } finally {
      busy = false;
    }
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && (isMac ? e.metaKey : e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  }
</script>

<Modal {title} size="md" {onclose} dismissible={!busy}>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <form id="add-values" class="form" onsubmit={submit} {onkeydown}>
    {@render options?.()}
    <div class="row">
      <Segmented
        size="sm"
        bind:value={mode}
        options={[
          { value: "lines", label: t("editors.add.lines") },
          { value: "single", label: t("editors.add.single") },
        ]}
      />
      {#if mode === "lines"}
        <label class="check small"><input type="checkbox" bind:checked={skipEmpty} /> {t("editors.add.skipEmpty")}</label>
      {/if}
    </div>
    <textarea bind:this={area} class="textarea mono" rows="9" bind:value={text} spellcheck="false" placeholder={mode === "lines" ? t("editors.add.linesPlaceholder") : t("editors.add.singlePlaceholder")} data-autofocus></textarea>
    <div class="hint">
      {mode === "lines" ? t("editors.add.count", { count: values.length }) : t("editors.add.singleHint")} · <span>{t("editors.add.submitHint", { keys: isMac ? "⌘↵" : "Ctrl+↵" })}</span>
    </div>
    {#if error}<div class="error-text">{error}</div>{/if}
  </form>
  {#snippet footer()}
    <button class="btn" onclick={onclose} disabled={busy}>{t("common.cancel")}</button>
    <button class="btn primary" type="submit" form="add-values" disabled={!valid || busy}>
      {#if busy}<Spinner size={12} />{/if}
      {t("common.add")}
    </button>
  {/snippet}
</Modal>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .small {
    font-size: var(--fs-sm);
    color: var(--text-2);
  }

  textarea {
    resize: vertical;
    min-height: 160px;
  }
</style>
