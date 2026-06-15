import { describe, it, expect } from "vitest";
import { parseDuration, formatDuration } from "./time.js";

describe("parseDuration", () => {
  it("h:mm", () => expect(parseDuration("1:30")).toBe(5400));
  it("hours", () => expect(parseDuration("2h")).toBe(7200));
  it("fractional hours", () => expect(parseDuration("1.5h")).toBe(5400));
  it("minutes", () => expect(parseDuration("45m")).toBe(2700));
  it("90m", () => expect(parseDuration("90m")).toBe(5400));
  it("combined", () => expect(parseDuration("1h30m")).toBe(5400));
  it("trims", () => expect(parseDuration(" 2h ")).toBe(7200));
  it("rejects empty", () => expect(() => parseDuration("")).toThrow(/duration/i));
  it("rejects garbage", () => expect(() => parseDuration("abc")).toThrow(/duration/i));
  it("rejects zero", () => expect(() => parseDuration("0h")).toThrow(/greater than zero/i));
});
describe("formatDuration", () => {
  it("h:mm", () => { expect(formatDuration(5400)).toBe("1:30"); expect(formatDuration(2700)).toBe("0:45"); });
});
