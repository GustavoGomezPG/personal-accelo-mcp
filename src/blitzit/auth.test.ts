import { describe, it, expect } from "vitest";
import { extractRefreshToken } from "./auth.js";

describe("extractRefreshToken", () => {
  it("finds an AMf- token in a binary-ish blob", () => {
    const rt = "AMf-" + "a".repeat(180);
    const blob = `\x00\x10garbage"refreshToken"\x00${rt}\x07more`;
    expect(extractRefreshToken(blob)).toBe(rt);
  });
  it("returns the longest AMf- token when several are present", () => {
    const short = "AMf-" + "b".repeat(60);
    const long = "AMf-" + "c".repeat(200);
    expect(extractRefreshToken(`${short} ... ${long}`)).toBe(long);
  });
  it("throws when no token is present", () => {
    expect(() => extractRefreshToken("nothing here")).toThrow(/token/i);
  });
});
