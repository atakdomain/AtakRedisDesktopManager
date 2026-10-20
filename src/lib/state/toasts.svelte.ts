import { ApiError } from "$lib/api";
import { t } from "$lib/i18n/index.svelte";

export type ToastKind = "info" | "success" | "warning" | "error";

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
  action?: { label: string; run: () => void };
  /** ms; 0 = elle kapatılana dek */
  timeout: number;
}

export const toasts = $state<Toast[]>([]);

let nextId = 1;

export function toast(kind: ToastKind, title: string, opts: { message?: string; action?: Toast["action"]; timeout?: number } = {}): number {
  const id = nextId++;
  const timeout = opts.timeout ?? (kind === "error" ? 8000 : 3500);
  toasts.push({ id, kind, title, message: opts.message, action: opts.action, timeout });
  if (toasts.length > 5) toasts.shift();
  if (timeout > 0) setTimeout(() => dismissToast(id), timeout);
  return id;
}

export function dismissToast(id: number): void {
  const index = toasts.findIndex((x) => x.id === id);
  if (index >= 0) toasts.splice(index, 1);
}

/** Hata bildirimi; iptal edilen işler sessiz geçer. */
export function toastError(err: unknown, title?: string): void {
  if (err instanceof ApiError) {
    if (err.kind === "cancelled") return;
    toast("error", title ?? t(`common.errors.${err.kind}`), { message: err.message });
    return;
  }
  toast("error", title ?? t("common.error"), { message: err instanceof Error ? err.message : String(err) });
}
