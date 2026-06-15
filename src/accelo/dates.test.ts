import { describe, it, expect } from "vitest";
import { dateStartEpochUTC, epochToDateStringUTC, currentWeekRange } from "./dates.js";

describe("dates", () => {
  it("dateStartEpochUTC", () => expect(dateStartEpochUTC("2026-06-08")).toBe(Date.UTC(2026,5,8,0,0,0)/1000));
  it("epochToDateStringUTC", () => expect(epochToDateStringUTC(Date.UTC(2026,5,8,12,0,0)/1000)).toBe("2026-06-08"));
  it("rejects malformed", () => expect(() => dateStartEpochUTC("06/08/2026")).toThrow(/date/i));
  it("currentWeekRange Mon..Sun", () => {
    expect(currentWeekRange(new Date(Date.UTC(2026,5,10,9,0,0)))).toEqual({ from: "2026-06-08", to: "2026-06-14" });
  });
});
