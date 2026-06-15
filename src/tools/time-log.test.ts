import { describe, it, expect, vi } from "vitest";
import { buildLogTimeTool } from "./time-log.js";
import type { AcceloClient } from "../accelo/client.js";
import type { AcceloConfig } from "../config.js";

const config = { deployment: "d", sessionCookie: "c", endpoint: "e", workdayStartHour: 8 } as AcceloConfig;
const LA_ME = { acceloConfig: { userConfig: { currentUser: { __typename: "Staff", id: "482", timezone: "America/Los_Angeles" } } } };
const EMPTY_NOTES = { notes: { edges: [] } };
const eightAmPdt = Date.UTC(2026, 5, 8, 15, 0, 0) / 1000; // 08:00 PDT on 2026-06-08

function client(): AcceloClient {
  return { query: vi.fn() as any, mutate: vi.fn().mockResolvedValue({ createWorkLogNote: { id: "n", subject: "s" } }) as any };
}
const entry = (o: number, d: string, t: string) => ({ objectId: o, projectLabel: "P", topic: "T", description: d, time: t });

describe("accelo_log_time (batch)", () => {
  it("is named correctly", () => {
    expect(buildLogTimeTool(client(), config).name).toBe("accelo_log_time");
  });

  it("previews an empty day starting at 08:00 then back-to-back, no writes", async () => {
    const c = client();
    (c.query as any).mockResolvedValueOnce(LA_ME).mockResolvedValueOnce(EMPTY_NOTES);
    const res = await buildLogTimeTool(c, config).handler({ date: "2026-06-08", entries: [entry(1, "A", "2h"), entry(2, "B", "1h")] });
    const p = JSON.parse(res.content[0].text);
    expect(p.preview).toBe(true);
    expect(p.tz).toBe("America/Los_Angeles");
    expect(p.entries.map((e: any) => [e.start, e.end])).toEqual([["08:00", "10:00"], ["10:00", "11:00"]]);
    expect(c.mutate).not.toHaveBeenCalled();
  });

  it("commits one mutation per entry with sequential workLogDate", async () => {
    const c = client();
    (c.query as any).mockResolvedValueOnce(LA_ME).mockResolvedValueOnce(EMPTY_NOTES);
    await buildLogTimeTool(c, config).handler({ date: "2026-06-08", entries: [entry(1, "A", "2h"), entry(2, "B", "1h")], confirm: true });
    expect((c.mutate as any).mock.calls).toHaveLength(2);
    expect((c.mutate as any).mock.calls[0][1].input.workLogDate).toBe(eightAmPdt);
    expect((c.mutate as any).mock.calls[0][1].input.workLogAgainstObject).toEqual({ id: 1, type: "task" });
    expect((c.mutate as any).mock.calls[0][1].input.workLogSubject).toBe("P :: T :: A");
    expect((c.mutate as any).mock.calls[1][1].input.workLogDate).toBe(eightAmPdt + 7200);
  });

  it("resumes after existing same-day entries (mix rule)", async () => {
    const c = client();
    // existing entry starts at 8am, 1h long -> ends 9am; new 1h entry must start at 9am
    const existing = { notes: { edges: [{ node: { id: "9", subject: "x", date: eightAmPdt, creator: { __typename: "Staff", id: "482" }, loggedWork: { billableTime: 3600, nonbillableTime: 0 }, againstObject: null } }] } };
    (c.query as any).mockResolvedValueOnce(LA_ME).mockResolvedValueOnce(existing);
    await buildLogTimeTool(c, config).handler({ date: "2026-06-08", entries: [entry(2, "B", "1h")], confirm: true });
    expect((c.mutate as any).mock.calls[0][1].input.workLogDate).toBe(eightAmPdt + 3600);
  });

  it("aborts the whole batch on an invalid duration, before any read or write", async () => {
    const c = client();
    await expect(buildLogTimeTool(c, config).handler({ date: "2026-06-08", entries: [entry(1, "A", "2h"), entry(2, "B", "bad")], confirm: true })).rejects.toThrow(/duration/i);
    expect(c.query).not.toHaveBeenCalled();
    expect(c.mutate).not.toHaveBeenCalled();
  });
});
