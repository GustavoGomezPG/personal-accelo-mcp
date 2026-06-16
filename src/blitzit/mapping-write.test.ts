import { describe, it, expect } from "vitest";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { groupByTarget, makeEntry, upsertMapping, removeMapping, writeMapping } from "./mapping-write.js";
import { loadMapping, type Mapping } from "./mapping.js";

describe("groupByTarget", () => {
  it("folds many labels that share one Accelo target into a single group", () => {
    const map: Mapping = {
      Internal: { objectType: "task", objectId: 35183, billable: false },
      "CAIA Connect": { objectType: "task", objectId: 35183, billable: false },
      Datamax: { objectType: "task", objectId: 37556 },
    };
    const groups = groupByTarget(map);
    expect(groups).toHaveLength(2);
    const internal = groups.find((g) => g.objectId === 35183)!;
    expect(internal.labels).toEqual(["CAIA Connect", "Internal"]);
    expect(internal.billable).toBe(false);
  });

  it("separates same objectId when billable differs", () => {
    const map: Mapping = {
      A: { objectType: "task", objectId: 1, billable: true },
      B: { objectType: "task", objectId: 1, billable: false },
    };
    expect(groupByTarget(map)).toHaveLength(2);
  });
});

describe("makeEntry", () => {
  it("defaults objectType to task", () => {
    expect(makeEntry({ objectId: 5 })).toEqual({ objectType: "task", objectId: 5 });
  });
  it("keeps billable and workTypeId when valid", () => {
    expect(makeEntry({ objectId: 5, billable: false, workTypeId: 9 })).toEqual({ objectType: "task", objectId: 5, billable: false, workTypeId: 9 });
  });
  it("rejects a non-positive objectId", () => {
    expect(() => makeEntry({ objectId: 0 })).toThrow(/objectId/i);
  });
});

describe("upsertMapping", () => {
  const entry = { objectType: "task", objectId: 35183, billable: false };
  it("maps several labels to one target (many-to-one)", () => {
    const { next, added } = upsertMapping({}, ["CAIAConnect", "Houston Eye"], entry);
    expect(added).toEqual(["CAIAConnect", "Houston Eye"]);
    expect(next.CAIAConnect).toEqual(entry);
    expect(next["Houston Eye"]).toEqual(entry);
  });
  it("reports updates when an existing label is retargeted, leaving the original untouched", () => {
    const map: Mapping = { CAIAConnect: { objectType: "task", objectId: 1 } };
    const { next, added, updated } = upsertMapping(map, ["CAIAConnect"], entry);
    expect(added).toEqual([]);
    expect(updated[0].from.objectId).toBe(1);
    expect(updated[0].to.objectId).toBe(35183);
    expect(map.CAIAConnect.objectId).toBe(1); // input not mutated
    expect(next.CAIAConnect.objectId).toBe(35183);
  });
  it("throws when no usable label is given", () => {
    expect(() => upsertMapping({}, ["  "], entry)).toThrow(/at least one/i);
  });
});

describe("removeMapping", () => {
  it("removes present labels and reports missing ones", () => {
    const map: Mapping = { A: { objectType: "task", objectId: 1 }, B: { objectType: "task", objectId: 2 } };
    const { next, removed, missing } = removeMapping(map, ["A", "Z"]);
    expect(removed[0].label).toBe("A");
    expect(missing).toEqual(["Z"]);
    expect(next.A).toBeUndefined();
    expect(next.B).toBeDefined();
    expect(map.A).toBeDefined(); // input not mutated
  });
});

describe("writeMapping", () => {
  it("writes a file that loadMapping can read back", () => {
    const p = join(tmpdir(), `blz-write-${process.pid}.json`);
    try {
      const map: Mapping = { Datamax: { objectType: "task", objectId: 37556 }, CAIAConnect: { objectType: "task", objectId: 35183, billable: false } };
      writeMapping(map, p);
      expect(readFileSync(p, "utf8").endsWith("\n")).toBe(true);
      expect(loadMapping(p)).toEqual(map);
    } finally {
      rmSync(p, { force: true });
      rmSync(`${p}.tmp`, { force: true });
    }
  });
});
