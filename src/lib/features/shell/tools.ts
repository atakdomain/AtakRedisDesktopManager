import { t } from "$lib/i18n/index.svelte";
import type { TabKind, Workspace } from "$lib/state/workspace.svelte";

/** Konsol, sunucu, yavaş sorgular, pub/sub — bağlantı başına tek sekme */
export function openToolTab(ws: Workspace, kind: Exclude<TabKind, "key" | "bulk">): void {
  ws.openTab({ id: kind, kind, title: t(`shell.tabs.${kind}`) });
}
