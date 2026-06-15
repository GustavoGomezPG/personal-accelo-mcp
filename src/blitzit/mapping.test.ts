import { describe, it, expect, afterEach } from "vitest";
import { parseMapping, resolveMapping, loadMapping, defaultMapPath } from "./mapping.js";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("parseMapping", () => {
  it("parses a valid map", () => {
    const m = parseMapping('{"Datamax":{"objectType":"task","objectId":123,"billable":false}}');
    expect(m.Datamax).toEqual({ objectType: "task", objectId: 123, billable: false });
  });
  it("rejects non-object JSON", () => {
    expect(() => parseMapping("[]")).toThrow(/object/i);
  });
  it("rejects an entry missing objectId", () => {
    expect(() => parseMapping('{"X":{"objectType":"task"}}')).toThrow(/objectId/i);
  });
  it("rejects an entry with a non-integer objectId", () => {
    expect(() => parseMapping('{"X":{"objectType":"task","objectId":"7"}}')).toThrow(/objectId/i);
  });
});

describe("resolveMapping", () => {
  const m = { Datamax: { objectType: "task", objectId: 1 } };
  it("returns the entry for a known project", () => {
    expect(resolveMapping(m, "Datamax")).toEqual({ objectType: "task", objectId: 1 });
  });
  it("returns undefined for an unknown project", () => {
    expect(resolveMapping(m, "Nope")).toBeUndefined();
  });
});

describe("parseMapping (additional guards)", () => {
  it("rejects objectId of 0 (unfilled placeholder)", () => {
    expect(() => parseMapping('{"X":{"objectType":"task","objectId":0}}')).toThrow(/objectId/i);
  });
  it("rejects an array entry", () => {
    expect(() => parseMapping('{"X":[1,2,3]}')).toThrow(/object/i);
  });
});

describe("defaultMapPath", () => {
  const prev = process.env.BLITZIT_ACCELO_MAP;
  afterEach(() => { if (prev === undefined) delete process.env.BLITZIT_ACCELO_MAP; else process.env.BLITZIT_ACCELO_MAP = prev; });
  it("uses the BLITZIT_ACCELO_MAP env var when set", () => {
    process.env.BLITZIT_ACCELO_MAP = "/tmp/custom-map.json";
    expect(defaultMapPath()).toBe("/tmp/custom-map.json");
  });
  it("falls back to the bundled path when the env var is empty", () => {
    process.env.BLITZIT_ACCELO_MAP = "   ";
    expect(defaultMapPath().endsWith("config/blitzit-accelo-map.json")).toBe(true);
  });
});

describe("loadMapping", () => {
  it("reads and parses a map file at an explicit path", () => {
    const p = join(tmpdir(), `blz-map-${Date.now()}.json`);
    writeFileSync(p, '{"Datamax":{"objectType":"task","objectId":5}}');
    try {
      expect(loadMapping(p)).toEqual({ Datamax: { objectType: "task", objectId: 5 } });
    } finally {
      rmSync(p, { force: true });
    }
  });
  it("throws an actionable error when the file is missing", () => {
    expect(() => loadMapping(join(tmpdir(), "definitely-missing-xyz.json"))).toThrow(/not found/i);
  });
});

describe("parseMapping (whitespace/workTypeId guards)", () => {
  it("rejects a whitespace-only objectType", () => {
    expect(() => parseMapping('{"X":{"objectType":"  ","objectId":1}}')).toThrow(/objectType/i);
  });
  it("ignores a non-positive workTypeId", () => {
    const m = parseMapping('{"X":{"objectType":"task","objectId":1,"workTypeId":-5}}');
    expect(m.X.workTypeId).toBeUndefined();
  });
  it("keeps a positive workTypeId", () => {
    const m = parseMapping('{"X":{"objectType":"task","objectId":1,"workTypeId":9}}');
    expect(m.X.workTypeId).toBe(9);
  });
});

describe("loadMapping (malformed JSON)", () => {
  it("throws a path-tagged error for invalid JSON in an existing file", () => {
    const p = join(tmpdir(), `blz-bad-${Date.now()}.json`);
    writeFileSync(p, "{not json");
    try {
      expect(() => loadMapping(p)).toThrow(/invalid blitzit/i);
    } finally {
      rmSync(p, { force: true });
    }
  });
});
