import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildListMappingsTool, buildUpdateMappingTool, buildRemoveMappingTool } from "./mapping-admin.js";

const MAP_PATH = join(tmpdir(), `blz-admin-${process.pid}.json`);
const SEED = {
  Datamax: { objectType: "task", objectId: 37556 },
  Internal: { objectType: "task", objectId: 35183, billable: false },
  "CAIA Connect": { objectType: "task", objectId: 35183, billable: false },
};

function parse(res: { content: Array<{ text: string }> }) {
  return JSON.parse(res.content[0].text);
}

describe("mapping admin tools", () => {
  const prev = process.env.BLITZIT_ACCELO_MAP;
  beforeEach(() => {
    process.env.BLITZIT_ACCELO_MAP = MAP_PATH;
    writeFileSync(MAP_PATH, JSON.stringify(SEED, null, 2));
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.BLITZIT_ACCELO_MAP; else process.env.BLITZIT_ACCELO_MAP = prev;
    rmSync(MAP_PATH, { force: true });
    rmSync(`${MAP_PATH}.tmp`, { force: true });
  });

  it("lists mappings grouped by target", async () => {
    const p = parse(await buildListMappingsTool().handler({}));
    expect(p.labelCount).toBe(3);
    expect(p.targetCount).toBe(2);
    const internal = p.targets.find((t: any) => t.objectId === 35183);
    expect(internal.labels).toEqual(["CAIA Connect", "Internal"]);
  });

  it("previews an update without writing", async () => {
    const p = parse(await buildUpdateMappingTool().handler({ labels: ["CAIAConnect"], objectId: 35183, billable: false }));
    expect(p.mode).toBe("preview");
    expect(p.willAdd).toEqual(["CAIAConnect"]);
    // file unchanged
    expect(JSON.parse(readFileSync(MAP_PATH, "utf8")).CAIAConnect).toBeUndefined();
  });

  it("writes a many-to-one update when confirmed", async () => {
    const p = parse(await buildUpdateMappingTool().handler({ labels: ["CAIAConnect", "Houston Eye"], objectId: 35183, billable: false, confirm: true }));
    expect(p.mode).toBe("written");
    expect(p.added).toEqual(["CAIAConnect", "Houston Eye"]);
    const onDisk = JSON.parse(readFileSync(MAP_PATH, "utf8"));
    expect(onDisk.CAIAConnect).toEqual({ objectType: "task", objectId: 35183, billable: false });
    expect(onDisk["Houston Eye"].objectId).toBe(35183);
  });

  it("removes a label when confirmed and reports missing ones", async () => {
    const p = parse(await buildRemoveMappingTool().handler({ labels: ["Datamax", "Nope"], confirm: true }));
    expect(p.mode).toBe("written");
    expect(p.removed).toEqual(["Datamax"]);
    expect(p.notFound).toEqual(["Nope"]);
    expect(JSON.parse(readFileSync(MAP_PATH, "utf8")).Datamax).toBeUndefined();
  });
});
