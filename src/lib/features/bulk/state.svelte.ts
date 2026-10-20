// Hızlı toplu işlem diyaloğu ve içe aktarma diyaloğu istekleri; gezgin (BrowserView) çizer.
// Toplu işlem sekmesi `openBulkTab` ile açılır; `data` sekmeyi ön ayarlar.
import type { KeyFilter } from "$lib/api/types";
import { t } from "$lib/i18n/index.svelte";
import type { Workspace } from "$lib/state/workspace.svelte";
import type { ActionKind, BulkDraft } from "./model/draft";
import type { SourceSpec } from "./source";

export interface BulkRequest {
  ws: Workspace;
  action: ActionKind;
  source: SourceSpec;
  draft?: Partial<BulkDraft>;
}

// Ham durum: kaynaktaki (olası yüz binlerce) anahtar vekile sarılmasın
class BulkUi {
  request = $state.raw<BulkRequest | null>(null);
  importFor = $state.raw<Workspace | null>(null);
}

export const bulkUi = new BulkUi();

export function openBulkDialog(request: BulkRequest): void {
  bulkUi.request = request;
}

export function openImport(ws: Workspace): void {
  bulkUi.importFor = ws;
}

export type TabSource = "selection" | "folder" | "search";

/** Toplu işlem sekmesinin ön ayarı (`tab.data`); `seq` aynı değerlerle yeniden açılışı da ayırt eder */
export interface BulkTabData {
  seq: number;
  source?: TabSource;
  folder?: string;
  filter?: KeyFilter;
  action?: ActionKind;
}

let seq = 0;

export function openBulkTab(ws: Workspace, data: Omit<BulkTabData, "seq"> = {}): void {
  ws.openTab({ id: "bulk", kind: "bulk", title: t("shell.tabs.bulk"), data: { ...data, seq: ++seq } satisfies BulkTabData });
}
