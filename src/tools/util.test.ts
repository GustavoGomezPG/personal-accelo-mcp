import { describe, it, expect } from "vitest";
import { text } from "./util.js";
describe("text", () => {
  it("wraps a value as pretty JSON MCP content", () => {
    expect(text({ a: 1 })).toEqual({ content: [{ type: "text", text: JSON.stringify({ a: 1 }, null, 2) }] });
  });
});
