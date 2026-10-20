// Raydaki sürükle-bırak: bırakılan yere göre yeni sıra ve (gerekirse) yeni grup.
import type { ConnectionConfig } from "$lib/api/types";
import { visualOrder } from "./connectionInfo";

export type DropTarget = { kind: "before" | "after"; id: string } | { kind: "group"; group: string };

export interface MoveResult {
  /** Tüm bağlantı kimlikleri, yeni görsel sırayla */
  ids: string[];
  /** Taşınan bağlantının yeni grubu */
  group: string;
}

/** Değişiklik yoksa null. Grup başlığına bırakmak bağlantıyı o grubun sonuna taşır. */
export function moveConnection(list: readonly ConnectionConfig[], dragId: string, target: DropTarget): MoveResult | null {
  const ordered = visualOrder(list);
  const dragged = ordered.find((c) => c.id === dragId);
  if (!dragged) return null;
  if (target.kind !== "group" && target.id === dragId) return null;

  const rest = ordered.filter((c) => c.id !== dragId);
  let index: number;
  let group: string;
  if (target.kind === "group") {
    group = target.group;
    let lastInGroup = -1;
    rest.forEach((c, i) => {
      if (c.group === group) lastInGroup = i;
    });
    index = lastInGroup >= 0 ? lastInGroup + 1 : rest.length;
  } else {
    const at = rest.findIndex((c) => c.id === target.id);
    if (at < 0) return null;
    group = rest[at].group;
    index = target.kind === "before" ? at : at + 1;
  }

  const ids = rest.map((c) => c.id);
  ids.splice(index, 0, dragId);
  // Grup değişince görsel sıra yeniden kurulur; yeni yerinin grup içinde kalması için tekrar sırala
  const moved = list.map((c) => (c.id === dragId ? { ...c, group } : c));
  const position = new Map(ids.map((id, i) => [id, i]));
  const finalIds = visualOrder(moved.map((c) => ({ ...c, order: position.get(c.id) ?? 0 }))).map((c) => c.id);

  const before = ordered.map((c) => c.id).join("\n");
  if (group === dragged.group && finalIds.join("\n") === before) return null;
  return { ids: finalIds, group };
}
