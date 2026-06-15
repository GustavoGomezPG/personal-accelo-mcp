import { describe, it, expect } from "vitest";
import { zonedDateTimeToEpoch, dayRangeEpoch, epochToHmInTz, todayInTz } from "./tz.js";

const LA = "America/Los_Angeles";

describe("tz", () => {
  it("8am PDT (June) = 15:00 UTC", () => {
    expect(zonedDateTimeToEpoch("2026-06-08", 8, 0, LA)).toBe(Date.UTC(2026, 5, 8, 15, 0, 0) / 1000);
  });
  it("8am PST (January) = 16:00 UTC", () => {
    expect(zonedDateTimeToEpoch("2026-01-08", 8, 0, LA)).toBe(Date.UTC(2026, 0, 8, 16, 0, 0) / 1000);
  });
  it("formats an epoch as HH:mm in tz", () => {
    expect(epochToHmInTz(Date.UTC(2026, 5, 8, 15, 0, 0) / 1000, LA)).toBe("08:00");
  });
  it("dayRangeEpoch spans the local day", () => {
    const r = dayRangeEpoch("2026-06-08", LA);
    expect(r.start).toBe(Date.UTC(2026, 5, 8, 7, 0, 0) / 1000); // 00:00 PDT
    expect(r.endExclusive).toBe(Date.UTC(2026, 5, 9, 7, 0, 0) / 1000);
  });
  it("todayInTz formats YYYY-MM-DD", () => {
    expect(todayInTz(LA, new Date(Date.UTC(2026, 5, 8, 9, 0, 0)))).toBe("2026-06-08"); // 02:00 PDT same day
  });
});
