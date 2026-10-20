<script lang="ts">
  let { size = 14 }: { size?: number } = $props();
</script>

<span class="spinner" style:width="{size}px" style:height="{size}px" role="progressbar" aria-busy="true"></span>

<style>
  .spinner {
    display: inline-block;
    flex: none;
    border: 2px solid color-mix(in srgb, currentColor 22%, transparent);
    border-top-color: currentColor;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
