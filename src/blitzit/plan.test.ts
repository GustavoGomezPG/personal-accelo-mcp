import { describe, it, expect } from "vitest";
import { planSync } from "./plan.js";
import type { BlitzitTask } from "./tasks.js";

const TZ = "America/Los_Angeles";
// 2026-06-08 ~08:00 PDT
const jun8 = Date.UTC(2026, 5, 8, 15, 0, 0);
const task = (id: string, project: string, seconds: number, endTimeMs: number, topic = "Web", detail = "did x"): BlitzitTask =>
  ({ id, project, topic, detail, seconds, endTimeMs, listId: "L1", board: "done" });

describe("planSync", () => {
  it("groups mapped tasks by local day and builds prepared entries", () => {
    const tasks = [task("a", "Datamax", 3600, jun8), task("b", "Datamax", 1800, jun8 + 3_600_000)];
    const plan = planSync({ tasks, mapping: { Datamax: { objectType: "task", objectId: 7 } }, existingKeys: new Set(), tz: TZ });
    expect(plan.days).toHaveLength(1);
    expect(plan.days[0].date).toBe("2026-06-08");
    expect(plan.days[0].prepared.map((p) => [p.subject, p.seconds, p.objectId])).toEqual([
      ["Datamax :: Web :: did x", 3600, 7],
      ["Datamax :: Web :: did x", 1800, 7],
    ]);
  });
  it("reports unmapped projects and never logs them", () => {
    const plan = planSync({ tasks: [task("a", "Nope", 3600, jun8)], mapping: {}, existingKeys: new Set(), tz: TZ });
    expect(plan.days).toHaveLength(0);
    expect(plan.unmapped).toEqual([{ project: "Nope", count: 1 }]);
  });
  it("skips zero-duration tasks", () => {
    const plan = planSync({ tasks: [task("a", "Datamax", 0, jun8)], mapping: { Datamax: { objectType: "task", objectId: 7 } }, existingKeys: new Set(), tz: TZ });
    expect(plan.days).toHaveLength(0);
    expect(plan.skippedZero).toEqual([{ id: "a", project: "Datamax" }]);
  });
  it("skips duplicates already present in Accelo (day + subject)", () => {
    const tasks = [task("a", "Datamax", 3600, jun8)];
    const existingKeys = new Set(["2026-06-08 Datamax :: Web :: did x"]);
    const plan = planSync({ tasks, mapping: { Datamax: { objectType: "task", objectId: 7 } }, existingKeys, tz: TZ });
    expect(plan.days).toHaveLength(0);
    expect(plan.skippedDuplicates).toEqual([{ date: "2026-06-08", subject: "Datamax :: Web :: did x" }]);
  });
  it("uses the title as-is when there is no real description (no duplication)", () => {
    const plan = planSync({ tasks: [task("a", "Datamax::Website::Fix ADP widgets", 60, jun8, "", "")], mapping: { "Datamax::Website": { objectType: "task", objectId: 7 } }, existingKeys: new Set(), tz: TZ });
    expect(plan.days[0].prepared[0].subject).toBe("Datamax::Website::Fix ADP widgets");
  });
});
