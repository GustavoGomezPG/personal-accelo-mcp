import { describe, it, expect } from "vitest";
import { loadConfig } from "./config.js";

const base = { ACCELO_DEPLOYMENT: "d", ACCELO_SESSION_COOKIE: "c" };

describe("loadConfig workday settings", () => {
  it("defaults workdayStartHour to 8 and workdayTz to undefined", () => {
    const c = loadConfig({ ...base });
    expect(c.workdayStartHour).toBe(8);
    expect(c.workdayTz).toBeUndefined();
  });
  it("parses ACCELO_WORKDAY_START_HOUR", () => {
    expect(loadConfig({ ...base, ACCELO_WORKDAY_START_HOUR: "9" }).workdayStartHour).toBe(9);
  });
  it("rejects an out-of-range start hour", () => {
    expect(() => loadConfig({ ...base, ACCELO_WORKDAY_START_HOUR: "30" })).toThrow(/start hour/i);
  });
  it("passes through ACCELO_WORKDAY_TZ", () => {
    expect(loadConfig({ ...base, ACCELO_WORKDAY_TZ: "America/Chicago" }).workdayTz).toBe("America/Chicago");
  });
});
