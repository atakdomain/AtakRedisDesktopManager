import { describe, expect, it } from "vitest";
import type { ConnectionConfig, ImportCandidate } from "$lib/api/types";
import { emptyConnection } from "$lib/state/connections.svelte";
import { defaultAction, planImport, type RowAction } from "./importPlan";

function config(patch: Partial<ConnectionConfig>): ConnectionConfig {
  return { ...emptyConnection(), ...patch };
}

function candidate(patch: Partial<ConnectionConfig>, duplicateOf = ""): ImportCandidate {
  return { config: config({ importedFrom: "ardm", ...patch }), warnings: [], duplicateOf };
}

const existing = [config({ id: "e1", name: "Yerel", host: "127.0.0.1", order: 4, env: "production", color: "#e5484d", group: "Atak", readOnly: true })];

const candidates = [
  candidate({ name: "Cache", host: "10.0.0.1" }),
  candidate({ name: "Yerel", host: "127.0.0.1", password: "new" }, "e1"),
  candidate({ name: "", host: "10.0.0.2", port: 7000 }),
];

describe("planImport", () => {
  it("skips duplicates by default", () => {
    const actions = candidates.map(defaultAction);
    const plan = planImport(candidates, actions, existing, { group: false });
    expect(plan.configs.map((c) => c.name)).toEqual(["Cache", ""]);
    expect(plan.rows).toEqual([0, 2]);
    expect(plan).toMatchObject({ added: 2, replaced: 0, skipped: 1 });
    expect(plan.configs.every((c) => c.id === "")).toBe(true);
  });

  it("replace keeps the existing id, order, tag, color, group and read-only", () => {
    const plan = planImport(candidates, ["skip", "replace", "skip"], existing, { group: true });
    expect(plan.configs).toHaveLength(1);
    expect(plan.configs[0]).toMatchObject({ id: "e1", order: 4, env: "production", color: "#e5484d", group: "Atak", readOnly: true, password: "new", name: "Yerel" });
    expect(plan).toMatchObject({ added: 0, replaced: 1, skipped: 2 });
  });

  it("keep both adds a numbered copy", () => {
    const plan = planImport(candidates, ["skip", "keepBoth", "skip"], existing, { group: false });
    expect(plan.configs[0]).toMatchObject({ id: "", name: "Yerel (2)" });
  });

  it("puts new connections into the ARDM group when asked", () => {
    const plan = planImport(candidates, ["import", "replace", "import"], existing, { group: true });
    expect(plan.configs.map((c) => c.group)).toEqual(["ARDM", "Atak", "ARDM"]);
  });

  it("numbers names that clash inside the same batch", () => {
    const twins = [candidate({ name: "Redis", host: "a" }), candidate({ name: "redis", host: "b" })];
    const plan = planImport(twins, ["import", "import"] satisfies RowAction[], [], { group: false });
    expect(plan.configs.map((c) => c.name)).toEqual(["Redis", "redis (2)"]);
  });

  it("does not mutate the candidates", () => {
    planImport(candidates, ["import", "keepBoth", "import"], existing, { group: true });
    expect(candidates[0].config.group).toBe("");
    expect(candidates[1].config.name).toBe("Yerel");
  });
});
