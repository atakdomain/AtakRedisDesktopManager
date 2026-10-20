import { describe, expect, it } from "vitest";
import type { ConnectionConfig } from "$lib/api/types";
import { emptyConnection } from "$lib/state/connections.svelte";
import { visualOrder } from "./connectionInfo";
import { moveConnection } from "./reorder";

function make(id: string, group = "", order = 0): ConnectionConfig {
  return { ...emptyConnection(), id, name: id, group, order };
}

// Görsel sıra: a, b (grupsuz) · Prod: p1, p2 · Test: t1
const list = [make("p1", "Prod", 0), make("a", "", 1), make("t1", "Test", 2), make("b", "", 3), make("p2", "Prod", 4)];

describe("visualOrder", () => {
  it("puts ungrouped first, then groups alphabetically", () => {
    expect(visualOrder(list).map((c) => c.id)).toEqual(["a", "b", "p1", "p2", "t1"]);
  });
});

describe("moveConnection", () => {
  it("moves within the same group", () => {
    expect(moveConnection(list, "p2", { kind: "before", id: "p1" })).toEqual({ ids: ["a", "b", "p2", "p1", "t1"], group: "Prod" });
  });

  it("moves into another group next to a row", () => {
    expect(moveConnection(list, "a", { kind: "after", id: "p1" })).toEqual({ ids: ["b", "p1", "a", "p2", "t1"], group: "Prod" });
  });

  it("appends to a group when dropped on its header", () => {
    expect(moveConnection(list, "b", { kind: "group", group: "Test" })).toEqual({ ids: ["a", "p1", "p2", "t1", "b"], group: "Test" });
  });

  it("can ungroup by dropping next to an ungrouped row", () => {
    expect(moveConnection(list, "t1", { kind: "before", id: "a" })).toEqual({ ids: ["t1", "a", "b", "p1", "p2"], group: "" });
  });

  it("returns null when nothing changes", () => {
    expect(moveConnection(list, "a", { kind: "before", id: "b" })).toBeNull();
    expect(moveConnection(list, "a", { kind: "after", id: "a" })).toBeNull();
    expect(moveConnection(list, "p2", { kind: "group", group: "Prod" })).toBeNull();
    expect(moveConnection(list, "missing", { kind: "before", id: "a" })).toBeNull();
  });
});
