<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import { allCommands } from "$lib/state/commands.svelte";
  import { ui } from "$lib/state/ui.svelte";
  import Kbd from "$lib/ui/Kbd.svelte";
  import Modal from "$lib/ui/Modal.svelte";

  const withShortcut = $derived(allCommands().filter((c) => c.shortcut));
</script>

<Modal title={t("shell.shortcuts.title")} size="md" onclose={() => (ui.shortcutsOpen = false)}>
  <ul>
    {#each withShortcut as command (command.id)}
      <li>
        <span class="truncate">{command.title()}</span>
        <Kbd shortcut={command.shortcut!} />
      </li>
    {/each}
  </ul>
</Modal>

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    height: 34px;
    border-bottom: 1px solid var(--border-subtle);
  }
</style>
