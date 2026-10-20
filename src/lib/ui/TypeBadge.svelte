<script lang="ts">
  import type { KeyType } from "$lib/api/types";

  let { type, compact = false }: { type: KeyType | undefined; compact?: boolean } = $props();

  const short: Record<string, string> = {
    string: "STR",
    hash: "HASH",
    list: "LIST",
    set: "SET",
    zset: "ZSET",
    stream: "STRM",
    "ReJSON-RL": "JSON",
    none: "—",
  };

  const tone = $derived(type === "ReJSON-RL" ? "json" : type && type in short ? type : "other");
  const text = $derived(type ? (short[type] ?? type.slice(0, 4).toUpperCase()) : "");
</script>

{#if type}
  <span class="badge {tone}" class:compact title={type}>{compact ? text.slice(0, 1) : text}</span>
{:else}
  <span class="badge placeholder" class:compact></span>
{/if}

<style>
  .badge {
    display: inline-grid;
    place-items: center;
    flex: none;
    min-width: 38px;
    height: 16px;
    padding: 0 4px;
    border-radius: 4px;
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.03em;
    line-height: 1;
    color: var(--c);
    background: color-mix(in srgb, var(--c) 14%, transparent);
  }

  .compact {
    min-width: 16px;
  }

  .placeholder {
    background: var(--bg-hover);
  }

  .string {
    --c: var(--type-string);
  }
  .hash {
    --c: var(--type-hash);
  }
  .list {
    --c: var(--type-list);
  }
  .set {
    --c: var(--type-set);
  }
  .zset {
    --c: var(--type-zset);
  }
  .stream {
    --c: var(--type-stream);
  }
  .json {
    --c: var(--type-json);
  }
  .other,
  .none {
    --c: var(--type-other);
  }
</style>
