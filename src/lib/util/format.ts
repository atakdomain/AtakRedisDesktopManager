import { fmtNumber, t } from "$lib/i18n/index.svelte";

export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${fmtNumber(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${fmtNumber(Math.round(value * 10) / 10)} ${units[unit]}`;
}

/** TTL (ms) → kısa insan dili: "45 sn", "3 sa", "12 gün". -1 → süresiz. */
export function fmtTtl(ms: number): string {
  if (ms === -1) return t("common.ttl.persistent");
  if (ms < 0) return t("common.ttl.expired");
  const s = Math.ceil(ms / 1000);
  if (s < 60) return t("common.ttl.seconds", { n: s });
  if (s < 3600) return t("common.ttl.minutes", { n: Math.floor(s / 60) });
  if (s < 86400) return t("common.ttl.hours", { n: Math.floor(s / 3600) });
  return t("common.ttl.days", { n: Math.floor(s / 86400) });
}

export function fmtDuration(ms: number): string {
  if (ms < 1) return `${fmtNumber(Math.round(ms * 100) / 100)} ms`;
  if (ms < 1000) return `${fmtNumber(Math.round(ms))} ms`;
  if (ms < 60000) return `${fmtNumber(Math.round(ms / 100) / 10)} s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function fmtDate(unixMs: number): string {
  return new Date(unixMs).toLocaleString();
}
