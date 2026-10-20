// Bir toplu işlemin baştan sona akışı: taslak → (gerekirse) önizleme → onay → (gerekirse) yedek → çalıştır → sonuç.
// Hızlı diyalog (BulkDialog) ve Toplu işlem sekmesi (BulkTab) aynı akışı kullanır.
import type { BulkAction } from "$lib/api/types";
import { t } from "$lib/i18n/index.svelte";
import { connections } from "$lib/state/connections.svelte";
import type { Job } from "$lib/state/jobs.svelte";
import type { Workspace } from "$lib/state/workspace.svelte";
import { afterJob, confirmBulk, jobTitle, PreviewRunner, requiredText, sampleLabels, startBulk, type PlannedRename } from "./execute.svelte";
import { exportFileName, pickSavePath } from "./files";
import { buildAction, newDraft, writesSource, type ActionKind, type BulkDraft, type DraftError, type DraftResult } from "./model/draft";
import type { SourceSpec } from "./source";

export type Phase = "edit" | "backup" | "running" | "result";

export interface Issue {
  code: DraftError | "noSource" | "readOnly" | "targetReadOnly" | "noMatches";
  detail?: string;
}

const SOFT = new Set<Issue["code"]>(["noSource", "findEmpty", "prefixSame"]);

const PREVIEW_PATH = "preview.jsonl";

/** Önizlemenin hangi seçeneklere bağlı olduğu: TTL süresi ya da dosya yolu değişince sayı değişmez */
function previewKey(source: SourceSpec, action: BulkAction): string {
  const normalized =
    action.kind === "expire"
      ? { kind: "expire", persist: action.ttlMs <= 0, only: action.onlyWithoutTtl }
      : action.kind === "export"
        ? { kind: "export" }
        : action;
  return `${source.id}|${JSON.stringify(normalized)}`;
}

export class BulkFlow {
  readonly ws: Workspace;
  draft = $state<BulkDraft>(newDraft("delete"));
  source = $state.raw<SourceSpec | null>(null);
  phase = $state<Phase>("edit");
  job = $state.raw<Job | null>(null);
  runError = $state<string | null>(null);
  readonly preview = new PreviewRunner();

  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(ws: Workspace, action: ActionKind, source: SourceSpec | null, patch: Partial<BulkDraft> = {}) {
    this.ws = ws;
    this.draft = newDraft(action, patch);
    this.source = source;
  }

  readonly built: DraftResult = $derived.by(() =>
    buildAction(this.draft, { connectionId: this.ws.connectionId, db: this.ws.db, now: Date.now(), previewPath: PREVIEW_PATH }),
  );

  /** Süzgeç kaynağında sayı yalnızca taramayla bilinir; yeniden adlandırma ve kopyada hedef notları gerekir */
  readonly needsPreview: boolean = $derived(
    this.source !== null && (this.source.kind === "filter" || this.draft.action === "rename" || this.draft.action === "copy"),
  );

  readonly signature: string = $derived(this.source && this.built.ok ? previewKey(this.source, this.built.action) : "");

  readonly previewFresh: boolean = $derived(this.signature !== "" && this.preview.isFresh(this.signature));

  /** Etkilenecek anahtar sayısı; bilinmiyorsa null */
  readonly count: number | null = $derived.by(() => {
    if (!this.source) return null;
    if (this.source.kind === "keys") return this.source.keys.length;
    return this.previewFresh ? this.preview.matched : null;
  });

  get production(): boolean {
    return connections.byId(this.ws.connectionId)?.env === "production";
  }

  /** Çalıştırmayı engelleyen ilk neden ya da null */
  readonly issue: Issue | null = $derived.by((): Issue | null => {
    if (!this.source) return { code: "noSource" };
    const built = this.built;
    if (!built.ok) return { code: built.error, detail: built.detail };
    if (this.ws.readOnly && writesSource(built.action)) return { code: "readOnly" };
    if (built.action.kind === "copy" && built.action.targetConnectionId && connections.byId(built.action.targetConnectionId)?.readOnly) {
      return { code: "targetReadOnly" };
    }
    if (this.count === 0) return { code: "noMatches" };
    return null;
  });

  /** Çalıştırmayı engelleyen ilk neden (metin) ya da null */
  readonly blocker: string | null = $derived(this.issue ? t(`bulk.errors.${this.issue.code}`, { detail: this.issue.detail ?? "" }) : null);

  /** Henüz doldurulmamış form (hata değil, kırmızı gösterilmez) */
  readonly incomplete: boolean = $derived(this.issue !== null && SOFT.has(this.issue.code));

  readonly canRun: boolean = $derived(this.phase === "edit" && this.blocker === null && this.count !== null && (!this.needsPreview || this.previewFresh));

  /** Canlı ortamda yazılması gereken bağlantı adı */
  readonly confirmText: string | null = $derived.by(() => (this.built.ok ? requiredText(this.ws, this.built.action) : null));

  get samples(): string[] {
    return sampleLabels(this.source, this.preview);
  }

  setSource(source: SourceSpec | null): void {
    this.source = source;
  }

  /** Bileşen etkisinden çağrılır: taslak/kaynak değişince kısa bir gecikmeyle önizler */
  schedulePreview(delay = 350): void {
    clearTimeout(this.timer);
    if (this.phase !== "edit" || !this.needsPreview || !this.source || !this.built.ok) {
      if (!this.needsPreview) this.preview.reset();
      return;
    }
    if (this.preview.signature === this.signature && (this.preview.running || this.preview.done)) return;
    const source = this.source;
    const action = this.built.action;
    const signature = this.signature;
    this.timer = setTimeout(() => this.preview.run(this.ws, source, action, signature), delay);
  }

  refreshPreview(): void {
    if (!this.source || !this.built.ok) return;
    clearTimeout(this.timer);
    this.preview.run(this.ws, this.source, this.built.action, this.signature);
  }

  /**
   * Çalıştırır. `confirmWith: "dialog"` → onay penceresi (sekme); "inline" → çağıran onayı kendi gösterdi (hızlı diyalog).
   * İş bitince çözülür; iş arka planda sürse de gezgin tazelenir ve bildirim gösterilir.
   */
  async run(confirmWith: "dialog" | "inline"): Promise<Job | null> {
    if (!this.canRun || !this.source || !this.built.ok) return null;
    const source = this.source;
    const count = this.count ?? 0;
    // TTL "tarih" modu çalıştırma anına göre yeniden hesaplanır
    const rebuilt = buildAction(this.draft, { connectionId: this.ws.connectionId, db: this.ws.db, now: Date.now() });
    if (!rebuilt.ok) {
      this.runError = t(`bulk.errors.${rebuilt.error}`, { detail: rebuilt.detail ?? "" });
      return null;
    }
    let action = rebuilt.action;
    // Türetilmiş değerler ilk await'ten önce okunur: diyalog kapanıp iş arka planda sürse de değerler sabittir
    const backup = action.kind === "delete" && this.draft.backup;
    const renames = this.plannedRenames(source, action);
    const samples = this.samples;
    if (confirmWith === "dialog" && !(await confirmBulk(this.ws, action, count, samples))) return null;

    const connName = connections.byId(this.ws.connectionId)?.name ?? "redis";
    if (action.kind === "export" && !action.path) {
      const path = await pickSavePath(t("bulk.run.pickExport"), exportFileName(connName, this.ws.db, action.format), action.format);
      if (!path) return null;
      action = { ...action, path };
      this.draft.path = path;
    }
    this.runError = null;

    if (backup) {
      const path = await pickSavePath(t("bulk.run.pickBackup"), exportFileName(connName, this.ws.db, "dump"), "dump");
      if (!path) return null;
      this.phase = "backup";
      const backupAction: BulkAction = { kind: "export", path, format: "dump" };
      const started = startBulk(this.ws, source, backupAction, jobTitle("export", source));
      this.job = started.job;
      const finished = await started.done;
      afterJob(this.ws, source, backupAction, finished);
      if (finished.status !== "done" || finished.summary?.cancelled || (finished.summary?.failed ?? 0) > 0) {
        this.runError = t("bulk.run.backupFailed");
        this.phase = "result";
        return finished;
      }
    }

    this.phase = "running";
    const { job, done } = startBulk(this.ws, source, action, jobTitle(action.kind, source));
    this.job = job;
    const finished = await done;
    afterJob(this.ws, source, action, finished, renames);
    this.phase = "result";
    return finished;
  }

  /** Önizleme tüm anahtarları kapsıyorsa eski → yeni eşleme (iş bitince gezgin yeniden aranmadan güncellenir) */
  private plannedRenames(source: SourceSpec, action: BulkAction): { moves: PlannedRename[]; skipped: number } | undefined {
    if (action.kind !== "rename" || source.kind !== "keys" || !this.previewFresh) return undefined;
    const samples = this.preview.samples;
    if (samples.length !== source.keys.length) return undefined;
    const moves: PlannedRename[] = [];
    let skipped = 0;
    for (const item of samples) {
      if (item.note !== "" || item.newKey === null) skipped++;
      else moves.push({ key: $state.snapshot(item.key), newKey: $state.snapshot(item.newKey) });
    }
    return { moves, skipped };
  }

  /** Sonuçtan forma dön (aynı kaynak ve seçeneklerle yeni işlem) */
  again(): void {
    this.job = null;
    this.runError = null;
    this.phase = "edit";
    this.preview.reset();
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.preview.reset();
  }
}

/** Gezgindeki ortak klasörden yeniden adlandırma ön ayarı */
export function renamePreset(folder: string | undefined, separator: string): Partial<BulkDraft> {
  if (!folder) return { renameMode: "replace" };
  const prefix = folder + separator;
  return { renameMode: "prefix", oldPrefix: prefix, newPrefix: prefix };
}
