import { describe, it, expect, vi } from "vitest";
import { buildListTimeTool } from "./time-list.js";
import type { AcceloClient } from "../accelo/client.js";

const ME = { acceloConfig: { userConfig: { currentUser: { __typename: "Staff", id: "482", timezone: "America/Los_Angeles" } } } };
const NOTES = { notes: { edges: [
  { node: { id: "1", subject: "A :: B :: C", date: Date.UTC(2026,5,8,15,0,0)/1000, creator: { __typename: "Staff", id: "482" }, loggedWork: { billableTime: 7200, nonbillableTime: 0 }, againstObject: { __typename: "Task", id: "9", title: "T" } } },
] } };

describe("accelo_list_my_time", () => {
  it("is named correctly", () => {
    const c: AcceloClient = { query: vi.fn() as any, mutate: vi.fn() as any };
    expect(buildListTimeTool(c).name).toBe("accelo_list_my_time");
  });
  it("lists entries for an explicit range and sums billable", async () => {
    const c: AcceloClient = { query: vi.fn() as any, mutate: vi.fn() as any };
    (c.query as any).mockResolvedValueOnce(ME).mockResolvedValueOnce(NOTES);
    const res = await buildListTimeTool(c).handler({ from: "2026-06-08", to: "2026-06-14" });
    const p = JSON.parse(res.content[0].text);
    expect(p.from).toBe("2026-06-08");
    expect(p.to).toBe("2026-06-14");
    expect(p.items).toHaveLength(1);
    expect(p.items[0]).toMatchObject({ id: "1", subject: "A :: B :: C", billable: "2:00", against: { type: "Task", id: "9", title: "T" } });
    expect(p.totalBillable).toBe("2:00");
    const notesVars = (c.query as any).mock.calls[1][1];
    expect(notesVars.f[0].epochs).toEqual([
      { key: "NoteDate", type: "greaterThanOrEqual", value: Date.UTC(2026,5,8,0,0,0)/1000 },
      { key: "NoteDate", type: "lessThan", value: Date.UTC(2026,5,15,0,0,0)/1000 },
    ]);
  });
});
