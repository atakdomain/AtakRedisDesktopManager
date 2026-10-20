// İçe aktarma planı: inceleme tablosundaki seçimlerden kaydedilecek bağlantı listesini üretir.
import type { ConnectionConfig, ImportCandidate } from "$lib/api/types";
import { displayName, uniqueName } from "$lib/features/connections/connectionInfo";

/**
 * Satır başına karar.
 * - import: yeni bağlantı olarak ekle (yinelenmeyen satırlar)
 * - skip: alma
 * - replace: var olanın bağlantı ayrıntılarını güncelle; kimlik, sıra, etiket, renk ve grup korunur
 * - keepBoth: yeni bağlantı olarak ekle, ada sıra numarası ekle
 */
export type RowAction = "import" | "skip" | "replace" | "keepBoth";

export const IMPORT_GROUP = "ARDM";

export function defaultAction(candidate: ImportCandidate): RowAction {
  return candidate.duplicateOf ? "skip" : "import";
}

export function isIncluded(action: RowAction): boolean {
  return action !== "skip";
}

export interface ImportPlan {
  configs: ConnectionConfig[];
  /** `configs[i]` hangi aday satırından geldi */
  rows: number[];
  added: number;
  replaced: number;
  skipped: number;
}

export function planImport(candidates: readonly ImportCandidate[], actions: readonly RowAction[], existing: readonly ConnectionConfig[], opts: { group: boolean }): ImportPlan {
  const plan: ImportPlan = { configs: [], rows: [], added: 0, replaced: 0, skipped: 0 };
  const taken = existing.map((c) => displayName(c));
  const replacedIds = new Set<string>();

  candidates.forEach((candidate, row) => {
    const action = actions[row] ?? defaultAction(candidate);
    const incoming: ConnectionConfig = structuredClone(candidate.config);
    incoming.importedFrom ||= "ardm";
    const target = candidate.duplicateOf ? existing.find((c) => c.id === candidate.duplicateOf) : undefined;

    if (action === "skip") {
      plan.skipped++;
      return;
    }

    if (action === "replace" && target && !replacedIds.has(target.id)) {
      replacedIds.add(target.id);
      plan.configs.push({
        ...incoming,
        id: target.id,
        name: target.name || incoming.name,
        order: target.order,
        env: target.env,
        color: target.color,
        group: target.group,
        // Salt okunur koruması gevşetilmez
        readOnly: target.readOnly || incoming.readOnly,
      });
      plan.rows.push(row);
      plan.replaced++;
      return;
    }

    incoming.id = "";
    if (opts.group) incoming.group = IMPORT_GROUP;
    // Aynı ad zaten varsa (yinelenen ya da bu partide ikinci kez) sıra numarası eklenir
    const name = displayName(incoming);
    const unique = uniqueName(name, taken);
    if (unique !== name) incoming.name = unique;
    taken.push(unique);
    plan.configs.push(incoming);
    plan.rows.push(row);
    plan.added++;
  });

  return plan;
}
