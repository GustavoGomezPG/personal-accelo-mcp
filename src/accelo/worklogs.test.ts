import { describe, it, expect, vi } from "vitest";
import { fetchMyWorkLogs, entryEnd } from "./worklogs.js";
import type { AcceloClient } from "./client.js";

const notes = { notes: { edges: [
  { node: { id: "1", subject: "A :: B :: C", date: 1000, creator: { __typename: "Staff", id: "482" }, loggedWork: { billableTime: 7200, nonbillableTime: 0 }, againstObject: { __typename: "Task", id: "9", title: "T" } } },
  { node: { id: "2", subject: "x", date: 2000, creator: { __typename: "Staff", id: "999" }, loggedWork: { billableTime: 60, nonbillableTime: 0 }, againstObject: null } },
] } };

describe("fetchMyWorkLogs", () => {
  it("filters to staffId, normalizes, and shapes the NoteDate range filter", async () => {
    const client: AcceloClient = { query: vi.fn().mockResolvedValue(notes) as any, mutate: vi.fn() as any };
    const out = await fetchMyWorkLogs(client, 500, 5000, "482");
    expect(out).toEqual([{ id: "1", startEpoch: 1000, subject: "A :: B :: C", billable: 7200, nonbillable: 0, against: { type: "Task", id: "9", title: "T" } }]);
    const [, vars] = (client.query as any).mock.calls[0];
    expect(vars.f[0].epochs).toEqual([
      { key: "NoteDate", type: "greaterThanOrEqual", value: 500 },
      { key: "NoteDate", type: "lessThan", value: 5000 },
    ]);
  });
  it("entryEnd = start + billable + nonbillable", () => {
    expect(entryEnd({ id: "1", startEpoch: 1000, subject: "", billable: 200, nonbillable: 100, against: null })).toBe(1300);
  });
});
