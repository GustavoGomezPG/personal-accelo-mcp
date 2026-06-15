import { describe, it, expect, vi } from "vitest";
import { buildDeleteTimeTool } from "./time-delete.js";
import type { AcceloClient } from "../accelo/client.js";
const client = (): AcceloClient => ({ query: vi.fn() as any, mutate: vi.fn().mockResolvedValue({ deleteWorkLog: true }) as any });

describe("accelo_delete_time", () => {
  it("named correctly", () => expect(buildDeleteTimeTool(client()).name).toBe("accelo_delete_time"));
  it("refuses without confirm:true", async () => {
    const c = client();
    const res = await buildDeleteTimeTool(c).handler({ noteId: 5 });
    const p = JSON.parse(res.content[0].text);
    expect(p.deleted).toBe(false);
    expect(p.note).toMatch(/confirm:true/);
    expect(c.mutate).not.toHaveBeenCalled();
  });
  it("deletes with confirm:true", async () => {
    const c = client();
    await buildDeleteTimeTool(c).handler({ noteId: 5, confirm: true });
    const [m, v] = (c.mutate as any).mock.calls[0];
    expect(m).toContain("deleteWorkLog");
    expect(v.input).toEqual({ workLogId: 5 });
  });
});
