// Toplu işler: arka planda sürer, ilerleme durum çubuğunda ve iş panelinde görünür.
import { api, ApiError } from "$lib/api";
import type { BulkEvent, BulkSampleItem, BulkSpec, BulkSummary, RBytes } from "$lib/api/types";
import { uid } from "$lib/util/id";

export type JobStatus = "running" | "done" | "cancelled" | "failed";

export interface JobProgress {
  scanned: number;
  matched: number;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  total: number | null;
}

export interface Job {
  id: string;
  connectionId: string;
  db: number;
  title: string;
  spec: BulkSpec | null;
  status: JobStatus;
  progress: JobProgress;
  samples: BulkSampleItem[];
  errors: { key: RBytes; message: string }[];
  summary: BulkSummary | null;
  error: string;
  startedAt: number;
}

export const jobs = $state<Job[]>([]);

function emptyProgress(): JobProgress {
  return { scanned: 0, matched: 0, processed: 0, succeeded: 0, failed: 0, skipped: 0, total: null };
}

function apply(job: Job, event: BulkEvent): void {
  switch (event.kind) {
    case "progress": {
      const { kind: _kind, ...progress } = event;
      job.progress = progress;
      break;
    }
    case "sample":
      job.samples.push(...event.items);
      break;
    case "error":
      job.errors.push({ key: event.key, message: event.message });
      break;
    case "done":
      job.summary = event.summary;
      break;
  }
}

type Runner = (jobId: string, onEvent: (e: BulkEvent) => void) => Promise<BulkSummary>;

async function start(job: Job, runner: Runner): Promise<Job> {
  jobs.unshift(job);
  const live = jobs[0];
  try {
    live.summary = await runner(live.id, (e) => apply(live, e));
    live.status = live.summary.cancelled ? "cancelled" : "done";
  } catch (err) {
    live.status = err instanceof ApiError && err.kind === "cancelled" ? "cancelled" : "failed";
    live.error = err instanceof Error ? err.message : String(err);
  }
  return live;
}

function newJob(connectionId: string, db: number, title: string, spec: BulkSpec | null): Job {
  return {
    id: uid(),
    connectionId,
    db,
    title,
    spec,
    status: "running",
    progress: emptyProgress(),
    samples: [],
    errors: [],
    summary: null,
    error: "",
    startedAt: Date.now(),
  };
}

/** Toplu işi başlatır; bitince (ya da iptalde) çözülür. Kuru çalıştırma da iş olarak izlenir ama listede gizlenir. */
export function runBulk(spec: BulkSpec, title: string): Promise<Job> {
  return start(newJob(spec.connectionId, spec.db, title, spec), (jobId, onEvent) => api.bulk.run(spec, jobId, onEvent));
}

export function runImport(connectionId: string, db: number, path: string, replace: boolean, title: string): Promise<Job> {
  return start(newJob(connectionId, db, title, null), (jobId, onEvent) => api.bulk.importFile(connectionId, db, path, replace, jobId, onEvent));
}

export function cancelJob(id: string): void {
  void api.bulk.cancel(id);
}

export function clearFinishedJobs(): void {
  for (let i = jobs.length - 1; i >= 0; i--) if (jobs[i].status !== "running") jobs.splice(i, 1);
}

export function runningJobs(): Job[] {
  return jobs.filter((j) => j.status === "running" && !j.spec?.dryRun);
}
