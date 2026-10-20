import type { KeyFilter, RBytes } from "$lib/api/types";
import type { Workspace } from "$lib/state/workspace.svelte";

/** Tür düzenleyicilerine KeyEditor'dan geçen ortak bağlam. */
export interface EditorContext {
  ws: Workspace;
  key: RBytes;
  /** Taslak/görünüm hatırası öneki: bağlantı/db/anahtar */
  scope: string;
  readOnly: boolean;
  /** Öğe sayısı değişti (ekleme/silme sonrası başlıktaki uzunluk) */
  onlength: (length: number) => void;
  /** Anahtar artık yok (süresi doldu, silindi ya da son öğe silinince Redis kaldırdı) */
  ongone: () => void;
}

/** Değer süzgeci: yalnızca "içerir" (joker * ? çalışır) */
export function valueFilter(term: string, caseSensitive: boolean): KeyFilter {
  return { mode: "contains", term, caseSensitive, types: [] };
}
