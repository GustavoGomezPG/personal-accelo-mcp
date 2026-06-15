import { describe, it, expect } from "vitest";
import { buildSubject } from "./nomenclature.js";
describe("buildSubject", () => {
  it("joins with ' :: '", () => expect(buildSubject("OptimizedIT", "Website", "Fixed header")).toBe("OptimizedIT :: Website :: Fixed header"));
  it("trims parts", () => expect(buildSubject(" A ", " B ", " C ")).toBe("A :: B :: C"));
  it("rejects an empty part", () => expect(() => buildSubject("A", "", "C")).toThrow(/required/i));
});
