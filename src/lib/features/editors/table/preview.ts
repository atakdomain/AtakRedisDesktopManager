import { label } from "$lib/api/bytes";
import type { RBytes } from "$lib/api/types";

const MAX = 400;

/** Tablo hücresi için tek satırlık önizleme: satır sonları ⏎, uzun değerler kırpılır. */
export function preview(value: RBytes): string {
  const text = typeof value === "string" ? value.slice(0, MAX * 2) : label(value).slice(0, MAX * 2);
  const flat = text.replace(/\r?\n/g, " ⏎ ").replace(/\t/g, " ");
  return flat.length > MAX ? `${flat.slice(0, MAX)}…` : flat;
}

/** Arama ve kopyalama için tam metin (ikili baytlar \xNN) */
export function plain(value: RBytes): string {
  return label(value);
}
