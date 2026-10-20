// ARDM algılamasının paylaşılan sonucu: ana sayfa sayıyı, sihirbaz adayları buradan okur.
import { api, ApiError } from "$lib/api";
import type { ArdmScan } from "$lib/api/types";

export const ardm = $state<{ scan: ArdmScan | null; error: ApiError | null; loading: boolean }>({ scan: null, error: null, loading: false });

let inflight: Promise<ArdmScan | null> | null = null;

/** Sürmekte olan çağrı varsa onu bekler; `force` değilse önbellekteki sonucu döner. */
export function detectArdm(force = false): Promise<ArdmScan | null> {
  if (inflight) return inflight;
  if (!force && (ardm.scan || ardm.error)) return Promise.resolve(ardm.scan);
  ardm.loading = true;
  inflight = api.importer
    .ardmDetect()
    .then((scan) => {
      ardm.scan = scan;
      ardm.error = null;
      return scan;
    })
    .catch((err: unknown) => {
      ardm.scan = null;
      ardm.error = err instanceof ApiError ? err : new ApiError("internal", String(err));
      return null;
    })
    .finally(() => {
      ardm.loading = false;
      inflight = null;
    });
  return inflight;
}

/** Yinelenmeyen (henüz burada olmayan) aday sayısı */
export function newCandidateCount(): number {
  return ardm.scan ? ardm.scan.candidates.filter((c) => !c.duplicateOf).length : 0;
}
