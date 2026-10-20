// TTL girdisi: "90" (seçili birimle), "15m", "2h30m", "1.5h", "1g 2sa", "45 sn" → milisaniye.

export type TtlUnit = "s" | "m" | "h" | "d";

export const UNIT_MS: Record<TtlUnit, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

const SUFFIX: Record<string, TtlUnit> = {
  s: "s",
  sn: "s",
  sec: "s",
  saniye: "s",
  m: "m",
  dk: "m",
  min: "m",
  dakika: "m",
  h: "h",
  sa: "h",
  hr: "h",
  saat: "h",
  d: "d",
  g: "d",
  gün: "d",
  gun: "d",
  day: "d",
  days: "d",
};

/** Redis PEXPIRE üst sınırı (≈ 292 milyon yıl) — taşmayı önlemek için */
const MAX_MS = Number.MAX_SAFE_INTEGER;

/** Geçersiz ya da sıfır/negatif → null */
export function parseTtl(input: string, unit: TtlUnit = "s"): number | null {
  const text = input.trim().toLowerCase().replace(",", ".");
  if (!text) return null;
  if (/^\d+(\.\d+)?$/.test(text)) return clamp(Number(text) * UNIT_MS[unit]);
  const part = /(\d+(?:\.\d+)?)\s*([a-zçğıöşü]+)/gy;
  let total = 0;
  let pos = 0;
  for (;;) {
    while (pos < text.length && text[pos] === " ") pos++;
    if (pos >= text.length) break;
    part.lastIndex = pos;
    const m = part.exec(text);
    if (!m) return null;
    const u = SUFFIX[m[2]];
    if (!u) return null;
    total += Number(m[1]) * UNIT_MS[u];
    pos = part.lastIndex;
  }
  return clamp(total);
}

function clamp(ms: number): number | null {
  const rounded = Math.round(ms);
  return rounded > 0 && rounded <= MAX_MS ? rounded : null;
}

export interface DurationParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export function splitDuration(ms: number): DurationParts {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

/** Girdiyi önceden doldurmak için en okunur birim: 7200000 → { value: 2, unit: "h" } */
export function bestUnit(ms: number): { value: number; unit: TtlUnit } {
  for (const unit of ["d", "h", "m"] as const) {
    if (ms >= UNIT_MS[unit] && ms % UNIT_MS[unit] === 0) return { value: ms / UNIT_MS[unit], unit };
  }
  return { value: Math.max(1, Math.round(ms / 1000)), unit: "s" };
}
