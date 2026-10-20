<script lang="ts">
  let { connectionId }: { connectionId: string } = $props();
</script>

<div class="placeholder">ConnectionStatusView {connectionId}</div>

<style>
  .placeholder {
    display: grid;
    place-items: center;
    height: 100%;
    color: var(--text-3);
    font-size: var(--fs-sm);
  }
</style>
