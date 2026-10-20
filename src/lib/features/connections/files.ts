// Yerel dosya seçimi. Tauri dışında (tarayıcı önizlemesi) yerel pencere yok; yol elle yazılır.
import { inTauri } from "$lib/api";
import { t } from "$lib/i18n/index.svelte";
import { prompt } from "$lib/state/dialogs.svelte";

export interface FileFilter {
  name: string;
  extensions: string[];
}

export async function pickFile(opts: { title: string; filters?: FileFilter[]; current?: string }): Promise<string | null> {
  if (inTauri) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ title: opts.title, multiple: false, directory: false, filters: opts.filters, defaultPath: opts.current || undefined });
    return typeof picked === "string" ? picked : null;
  }
  const typed = await prompt({
    title: opts.title,
    label: t("connections.editor.filePathLabel"),
    value: opts.current ?? "",
    mono: true,
    validate: (value) => (value.trim() ? null : t("common.required")),
  });
  return typed?.trim() || null;
}
