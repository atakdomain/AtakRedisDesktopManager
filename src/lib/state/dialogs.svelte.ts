// Söz veren (Promise) onay ve metin istemi; tek bir <DialogHost/> App.svelte'de çizer.

export interface ConfirmOptions {
  title: string;
  message?: string;
  /** Ek ayrıntı satırları (ör. silinecek anahtarlardan örnekler) */
  details?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Verilirse kullanıcı bu metni yazmadan onay düğmesi açılmaz (canlı ortam koruması) */
  requireText?: string;
}

export interface PromptOptions {
  title: string;
  message?: string;
  label?: string;
  value?: string;
  placeholder?: string;
  confirmLabel?: string;
  mono?: boolean;
  /** Hata metni döndürürse onay kapalı kalır */
  validate?: (value: string) => string | null;
}

export type DialogRequest =
  | { kind: "confirm"; options: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: "prompt"; options: PromptOptions; resolve: (value: string | null) => void };

export const dialogQueue = $state<DialogRequest[]>([]);

export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => dialogQueue.push({ kind: "confirm", options, resolve }));
}

export function prompt(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => dialogQueue.push({ kind: "prompt", options, resolve }));
}
