import { describe, it, expect, vi } from "vitest";
import { buildEditTimeTool } from "./time-edit.js";
import type { AcceloClient } from "../accelo/client.js";
const client = (): AcceloClient => ({ query: vi.fn() as any, mutate: vi.fn().mockResolvedValue({}) as any });

describe("accelo_edit_time", () => {
  it("named correctly", () => expect(buildEditTimeTool(client()).name).toBe("accelo_edit_time"));
  it("previews without writing", async () => {
    const c = client();
    const res = await buildEditTimeTool(c).handler({ noteId: 5, time: "1:30" });
    expect(JSON.parse(res.content[0].text).preview).toBe(true);
    expect(c.mutate).not.toHaveBeenCalled();
  });
  it("updates logged time when confirmed", async () => {
    const c = client();
    await buildEditTimeTool(c).handler({ noteId: 5, time: "1:30", confirm: true });
    const [m, v] = (c.mutate as any).mock.calls[0];
    expect(m).toContain("updateNoteLoggedTime");
    expect(v.input).toEqual({ noteId: 5, noteLoggedTime: 5400 });
  });
  it("updates subject from parts when confirmed", async () => {
    const c = client();
    await buildEditTimeTool(c).handler({ noteId: 5, projectLabel: "A", topic: "B", description: "C", confirm: true });
    const subj = (c.mutate as any).mock.calls.find((x: any[]) => x[0].includes("updateNoteSubject"));
    expect(subj[1].input).toEqual({ noteId: 5, noteSubject: "A :: B :: C" });
  });
  it("rejects with no change", async () => {
    const c = client();
    await expect(buildEditTimeTool(c).handler({ noteId: 5, confirm: true })).rejects.toThrow(/no change/i);
    expect(c.mutate).not.toHaveBeenCalled();
  });
});
