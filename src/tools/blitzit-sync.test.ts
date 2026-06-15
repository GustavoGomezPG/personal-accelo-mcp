import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../blitzit/auth.js", () => ({ getBlitzitAuth: vi.fn(async () => ({ idToken: "t", uid: "u" })) }));
vi.mock("../blitzit/client.js", () => ({ createBlitzitClient: vi.fn(() => ({ queryTasksByOwner: vi.fn() })) }));
vi.mock("../blitzit/mapping.js", () => ({
  loadMapping: vi.fn(() => ({ Datamax: { objectType: "task", objectId: 7 } })),
  resolveMapping: vi.fn((map: Record<string, unknown>, project: string) => map[project]),
}));

const jun8 = Date.UTC(2026, 5, 8, 15, 0, 0); // ~08:00 PDT
vi.mock("../blitzit/tasks.js", () => ({
  fetchWeekDoneTasks: vi.fn(async () => [
    { id: "a", project: "Datamax", topic: "Web", detail: "dns", seconds: 3600, endTimeMs: jun8, listId: "L1", board: "done" },
    { id: "b", project: "Nope", topic: "Web", detail: "x", seconds: 3600, endTimeMs: jun8, listId: "L1", board: "done" },
  ]),
}));

import { buildBlitzitSyncTool } from "./blitzit-sync.js";
import type { AcceloClient } from "../accelo/client.js";
import type { AcceloConfig } from "../config.js";
import { fetchWeekDoneTasks } from "../blitzit/tasks.js";

const config = { deployment: "d", sessionCookie: "c", endpoint: "e", workdayStartHour: 8, workdayTz: "America/Los_Angeles" } as AcceloConfig;
const LA_ME = { acceloConfig: { userConfig: { currentUser: { __typename: "Staff", id: "482", timezone: "America/Los_Angeles" } } } };
const EMPTY_NOTES = { notes: { edges: [] } };

function client(): AcceloClient {
  return { query: vi.fn() as any, mutate: vi.fn().mockResolvedValue({ createWorkLogNote: { id: "n", subject: "s" } }) as any };
}

describe("accelo_sync_blitzit_week", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is named correctly", () => {
    expect(buildBlitzitSyncTool(client(), config).name).toBe("accelo_sync_blitzit_week");
  });

  it("previews mapped tasks, reports unmapped, and writes nothing", async () => {
    const c = client();
    (c.query as any).mockResolvedValueOnce(LA_ME).mockResolvedValueOnce(EMPTY_NOTES).mockResolvedValueOnce(EMPTY_NOTES);
    const res = await buildBlitzitSyncTool(c, config).handler({ from: "2026-06-08", to: "2026-06-14" });
    const p = JSON.parse(res.content[0].text);
    expect(p.mode).toBe("preview");
    expect(p.days).toHaveLength(1);
    expect(p.days[0].date).toBe("2026-06-08");
    expect(p.days[0].entries[0].subject).toBe("Datamax :: Web :: dns");
    expect(p.unmapped).toEqual([{ project: "Nope", count: 1 }]);
    expect(c.mutate).not.toHaveBeenCalled();
  });

  it("logs when confirm:true", async () => {
    const c = client();
    (c.query as any).mockResolvedValueOnce(LA_ME).mockResolvedValueOnce(EMPTY_NOTES).mockResolvedValueOnce(EMPTY_NOTES);
    const res = await buildBlitzitSyncTool(c, config).handler({ from: "2026-06-08", to: "2026-06-14", confirm: true });
    const p = JSON.parse(res.content[0].text);
    expect(p.mode).toBe("logged");
    expect((c.mutate as any).mock.calls).toHaveLength(1);
    expect((c.mutate as any).mock.calls[0][1].input.workLogSubject).toBe("Datamax :: Web :: dns");
    expect(p.days).toHaveLength(1);
    expect(p.days[0].logged).toBe(1);
  });

  it("schedules each completion day separately", async () => {
    const jun9 = Date.UTC(2026, 5, 9, 15, 0, 0);
    (fetchWeekDoneTasks as any).mockResolvedValueOnce([
      { id: "a", project: "Datamax", topic: "Web", detail: "day1", seconds: 3600, endTimeMs: jun8, listId: "L1", board: "done" },
      { id: "b", project: "Datamax", topic: "Web", detail: "day2", seconds: 3600, endTimeMs: jun9, listId: "L1", board: "done" },
    ]);
    const c = client();
    // getCurrentUser, week-dedup fetch, then one per-day fetch for each of the 2 days
    (c.query as any).mockResolvedValueOnce(LA_ME).mockResolvedValueOnce(EMPTY_NOTES).mockResolvedValueOnce(EMPTY_NOTES).mockResolvedValueOnce(EMPTY_NOTES);
    const res = await buildBlitzitSyncTool(c, config).handler({ from: "2026-06-08", to: "2026-06-14", confirm: true });
    const p = JSON.parse(res.content[0].text);
    expect(p.days.map((d: any) => d.date)).toEqual(["2026-06-08", "2026-06-09"]);
    expect((c.mutate as any).mock.calls).toHaveLength(2);
  });
});
