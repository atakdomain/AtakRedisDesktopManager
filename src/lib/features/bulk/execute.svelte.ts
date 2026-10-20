// Toplu işi başlatma, önizleme (kuru çalıştırma), onay, iş bitince gezgini tazeleme ve bildirim.
// Tüm yürütme `jobs.runBulk` üzerinden gider; işler durum çubuğundaki panelde de izlenir.
import { bytesId, label } from "$lib/api/bytes";
import type { BulkAction, BulkSpec, RBytes } from "$lib/api/types";
import { t } from "$lib/i18n/index.svelte";
import { connections } from "$lib/state/connections.svelte";
import { confirm } from "$lib/state/dialogs.svelte";
import { cancelJob, jobs, runBulk, type Job } from "$lib/state/jobs.svelte";
import { toast } from "$lib/state/toasts.svelte";
import { ui } from "$lib/state/ui.svelte";
import type { Workspace } from "$lib/state/workspace.svelte";
import { fmtDuration } from "$lib/util/format";
import { isDestructive, writesSource, type ActionKind } from "./model/draft";
import { sourceLabel, toBulkSource, type SourceSpec } from "./source";

/** Bu sayıya kadar anahtar listesiyle gelen işlerde gezgin yerinde güncellenir; üstünde yeniden aranır */
const LOCAL_REFRESH_LIMIT = 5000;

export function jobTitle(action: ActionKind, source: SourceSpec): string {
  return t("bulk.jobs.title", { action: t(`bulk.actions.${action}`), source: sourceLabel(source) });
}

/** İşi başlatır; dönen `job` canlı (ilerleme akarken okunabilir), `done` bitince çözülür. */
export function startBulk(ws: Workspace, source: SourceSpec, action: BulkAction, title: string, dryRun = false): { job: Job; done: Promise<Job> } {
  const spec: BulkSpec = { connectionId: ws.connectionId, db: ws.db, source: toBulkSource(source), action, dryRun };
  const done = runBulk(spec, title);
  // runBulk işi eşzamanlı olarak listenin başına koyar
  return { job: jobs[0], done };
}

/** Kuru çalıştırmalar iş listesinde gizlidir; işi bitince listeden çıkarılır ki birikmesin */
export function discardJob(job: Job): void {
  const index = jobs.indexOf(job);
  if (index >= 0) jobs.splice(index, 1);
}

/** Canlı ortam koruması: yazılması gereken bağlantı adı ya da null */
export function requiredText(ws: Workspace, action: BulkAction): string | null {
  const source = connections.byId(ws.connectionId);
  if (action.kind === "copy" && action.targetConnectionId) {
    const target = connections.byId(action.targetConnectionId);
    if (target?.env === "production") return target.name;
    if (!action.moveKeys) return null;
  }
  if (source?.env === "production" && isDestructive(action)) return source.name;
  return null;
}

/** Çalıştırmadan önceki onay (Toplu işlem sekmesi). Yıkıcı değilse ve canlı değilse sormadan geçer. */
export async function confirmBulk(ws: Workspace, action: BulkAction, count: number, samples: string[]): Promise<boolean> {
  const text = requiredText(ws, action);
  const destructive = isDestructive(action);
  if (!destructive && !text) return true;
  const lines = [action.kind === "delete" ? t("bulk.run.confirmDelete", { count }) : t("bulk.run.confirmGeneric", { count })];
  if (text) lines.push(t("bulk.run.confirmProduction", { name: text }));
  return confirm({
    title: t("bulk.run.confirmTitle", { action: t(`bulk.actionTitles.${action.kind}`) }),
    message: lines.join("\n"),
    details: samples.slice(0, 10).concat(count > 10 && samples.length ? ["…"] : []),
    danger: destructive,
    requireText: text ?? undefined,
    confirmLabel: runLabel(action, count),
  });
}

export function runLabel(action: BulkAction, count: number | null): string {
  if (count === null) return t("bulk.run.run");
  if (action.kind === "copy") return action.moveKeys ? t("bulk.run.move", { count }) : t("bulk.run.copy", { count });
  return t(`bulk.run.${action.kind}`, { count });
}

/** İş bitince: gezgini tazele (küçük anahtar listelerinde yerinde, yoksa yeniden ara) ve bildir */
/** Önizlemede bulunan eski → yeni eşleme; yeniden adlandırma sorunsuz biterse gezgin yerinde güncellenir */
export interface PlannedRename {
  key: RBytes;
  newKey: RBytes;
}

export function afterJob(ws: Workspace, source: SourceSpec, action: BulkAction, job: Job, renames?: { moves: PlannedRename[]; skipped: number }): void {
  if (!(renames && renameLocally(ws, job, renames))) refreshAfter(ws, source, action, job);
  notifyJob(job);
}

function renameLocally(ws: Workspace, job: Job, renames: { moves: PlannedRename[]; skipped: number }): boolean {
  const summary = job.summary;
  if (job.status !== "done" || !summary || summary.cancelled || summary.failed > 0 || summary.skipped !== renames.skipped) return false;
  for (const { key, newKey } of renames.moves) ws.renameKey(key, newKey);
  return true;
}

function refreshAfter(ws: Workspace, source: SourceSpec, action: BulkAction, job: Job): void {
  const summary = job.summary;
  const touched = (summary?.succeeded ?? 0) > 0 || job.status !== "done";
  if (action.kind === "export" || !touched) return;
  const clean = job.status === "done" && !summary?.cancelled;
  const local = clean && source.kind === "keys" && source.keys.length <= LOCAL_REFRESH_LIMIT;
  const failed = new Set(job.errors.map((e) => bytesId(e.key)));
  const ids = source.kind === "keys" ? source.keys.map(bytesId).filter((id) => !failed.has(id)) : [];

  if (action.kind === "expire") {
    ws.invalidateMeta(source.kind === "keys" ? ids : ws.keyList.map(bytesId));
    return;
  }
  const removesSource = action.kind === "delete" || (action.kind === "copy" && action.moveKeys);
  if (removesSource && local && (action.kind === "delete" || (summary?.skipped ?? 0) === 0)) {
    ws.removeKeys(ids);
  } else if (writesSource(action)) {
    void ws.search();
  }
  void ws.loadDbs();
}

export function notifyJob(job: Job): void {
  const summary = job.summary;
  const title = job.title;
  const details = { label: t("bulk.toast.details"), run: () => (ui.jobsOpen = true) };
  if (job.status === "failed") {
    toast("error", t("bulk.toast.failed", { title }), { message: job.error, action: details });
    return;
  }
  const message = summary
    ? t("bulk.toast.summary", { succeeded: summary.succeeded, failed: summary.failed, skipped: summary.skipped, time: fmtDuration(summary.elapsedMs) }) +
      (summary.outputPath ? `\n${summary.outputPath}` : "")
    : undefined;
  if (job.status === "cancelled" || summary?.cancelled) toast("info", t("bulk.toast.cancelled", { title }), { message, action: details });
  else if ((summary?.failed ?? 0) > 0) toast("warning", t("bulk.toast.partial", { title }), { message, action: details, timeout: 8000 });
  else toast("success", t("bulk.toast.done", { title }), { message, action: details });
}

/** İlk 10 örnek ad: anahtar kaynağında yerelden, süzgeçte önizleme örneklerinden */
export function sampleLabels(source: SourceSpec | null, preview: PreviewRunner, limit = 10): string[] {
  if (!source) return [];
  if (source.kind === "keys") return source.keys.slice(0, limit).map(label);
  return preview.samples.slice(0, limit).map((s) => label(s.key));
}

/** Kuru çalıştırma: tam eşleşme sayısı + ilk 500 örnek. Yenisi başlarken öncekini iptal eder. */
export class PreviewRunner {
  job = $state.raw<Job | null>(null);
  signature = $state("");

  get running(): boolean {
    return this.job?.status === "running";
  }

  /** Bitti ve iptal edilmedi */
  get done(): boolean {
    return this.job?.status === "done" && !this.job.summary?.cancelled;
  }

  get matched(): number | null {
    return this.done ? (this.job?.summary?.matched ?? null) : null;
  }

  get progress() {
    return this.job?.progress ?? null;
  }

  get samples() {
    return this.job?.samples ?? [];
  }

  get skipped(): number {
    return this.done ? (this.job?.summary?.skipped ?? 0) : 0;
  }

  get error(): string | null {
    return this.job?.status === "failed" ? this.job.error : null;
  }

  isFresh(signature: string): boolean {
    return this.signature === signature && this.done;
  }

  run(ws: Workspace, source: SourceSpec, action: BulkAction, signature: string): void {
    this.stop();
    const { job, done } = startBulk(ws, source, action, t("bulk.jobs.preview"), true);
    this.job = job;
    this.signature = signature;
    void done.then(() => discardJob(job));
  }

  stop(): void {
    if (this.job?.status === "running") cancelJob(this.job.id);
  }

  reset(): void {
    this.stop();
    this.job = null;
    this.signature = "";
  }
}
