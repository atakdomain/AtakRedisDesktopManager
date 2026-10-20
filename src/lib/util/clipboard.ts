import { inTauri } from "$lib/api";

/** Panoya metin yazar. Linux WebKitGTK'da navigator.clipboard güvenilir olmadığından Tauri eklentisi kullanılır. */
export async function copyText(text: string): Promise<void> {
  if (inTauri) {
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    await writeText(text);
    return;
  }
  await navigator.clipboard.writeText(text);
}

export async function readText(): Promise<string> {
  if (inTauri) {
    const { readText: read } = await import("@tauri-apps/plugin-clipboard-manager");
    return read();
  }
  return navigator.clipboard.readText();
}
