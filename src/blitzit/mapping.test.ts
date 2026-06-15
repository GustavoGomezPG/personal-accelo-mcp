import { describe, it, expect } from "vitest";
import { parseMapping, resolveMapping } from "./mapping.js";

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
