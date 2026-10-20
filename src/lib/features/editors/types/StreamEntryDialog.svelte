<script lang="ts">
  // Stream'e girdi ekleme (XADD): kimlik ("*" = otomatik) + dinamik alan/değer satırları.
  import { api } from "$lib/api";
  import type { RBytes } from "$lib/api/types";
  import { t } from "$lib/i18n/index.svelte";
  import { isMac } from "$lib/state/commands.svelte";
  import Modal from "$lib/ui/Modal.svelte";
  import Spinner from "$lib/ui/Spinner.svelte";
  import { describeError } from "../messages";
  import FieldRows, { type FieldRow } from "../table/FieldRows.svelte";

  interface Props {
    connectionId: string;
    db: number;
    keyName: RBytes;
    onadded: (id: string, fields: { field: string; value: string }[]) => void;
    onclose: () => void;
  }

  let { connectionId, db, keyName, onadded, onclose }: Props = $props();

  let id = $state("*");
  let rows = $state<FieldRow[]>([{ field: "", value: "" }]);
  let busy = $state(false);
  let error = $state<string | null>(null);

  const filled = $derived(rows.filter((r) => r.field !== ""));
  const idValid = $derived(/^(\*|\d+(-(\d+|\*))?)$/.test(id.trim()));

  async function submit(e?: SubmitEvent) {
    e?.preventDefault();
    if (busy) return;
    if (!idValid) {
      error = t("editors.stream.badId");
      return;
    }
    if (filled.length === 0) {
      error = t("editors.stream.needField");
      return;
    }
    busy = true;
    error = null;
    try {
      const fields = filled.map((r) => ({ field: r.field, value: r.value }));
      const newId = await api.stream.add(connectionId, db, keyName, id.trim() === "*" ? "" : id.trim(), fields);
      onadded(newId, fields);
      onclose();
    } catch (err) {
      error = describeError(err);
    } finally {
      busy = false;
    }
  }
</script>

<Modal title={t("editors.stream.addTitle")} size="md" {onclose} dismissible={!busy}>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <form
    id="stream-add"
    class="form"
    onsubmit={submit}
    onkeydown={(e) => {
      if (e.key === "Enter" && (isMac ? e.metaKey : e.ctrlKey)) {
        e.preventDefault();
        void submit();
      }
    }}
  >
    <div class="field">
      <label for="stream-id">{t("editors.stream.id")}</label>
      <input id="stream-id" class="input sm mono id" class:invalid={!idValid} bind:value={id} spellcheck="false" autocomplete="off" />
      <span class="hint">{t("editors.stream.idHint")}</span>
    </div>
    <FieldRows bind:rows idPrefix="stream-add" />
    {#if error}<div class="error-text">{error}</div>{/if}
  </form>
  {#snippet footer()}
    <button class="btn" onclick={onclose} disabled={busy}>{t("common.cancel")}</button>
    <button class="btn primary" type="submit" form="stream-add" disabled={busy || filled.length === 0}>
      {#if busy}<Spinner size={12} />{/if}
      {t("common.add")}
    </button>
  {/snippet}
</Modal>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .id {
    max-width: 260px;
  }
</style>
