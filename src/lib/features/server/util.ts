import { t } from "$lib/i18n/index.svelte";

/** Saniye → "12 g 3 sa", "3 sa 12 dk", "4 dk 10 sn", "45 sn" */
export function fmtUptime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (d > 0) return `${t("server.time.d", { n: d })} ${t("server.time.h", { n: h })}`;
  if (h > 0) return `${t("server.time.h", { n: h })} ${t("server.time.m", { n: m })}`;
  if (m > 0) return `${t("server.time.m", { n: m })} ${t("server.time.s", { n: r })}`;
  return t("server.time.s", { n: r });
}

/** Unix saniye → "5 dk önce" */
export function fmtAgo(unixSec: number, nowMs = Date.now()): string {
  return t("server.time.ago", { time: fmtUptime(nowMs / 1000 - unixSec) });
}

/** Büyük/küçük harf duyarsız eşleşmeyi vurgulamak için [önce, eşleşen, sonra] parçaları */
export function splitMatch(text: string, query: string): [string, string, string] | null {
  if (!query) return null;
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return null;
  return [text.slice(0, i), text.slice(i, i + query.length), text.slice(i + query.length)];
}

/** Yavaş sorgu süresinin (µs) ton sınıfı */
export function durationTone(us: number): "low" | "mid" | "high" | "severe" {
  if (us < 1_000) return "low";
  if (us < 10_000) return "mid";
  if (us < 100_000) return "high";
  return "severe";
}
