import { describe, it, expect } from "vitest";
import { shapeConnection } from "./shape.js";

describe("shapeConnection", () => {
  it("flattens edges to items and lifts paging info", () => {
    const conn = {
      totalCount: 2,
      pageInfo: { hasNextPage: true, endCursor: "CURSOR" },
      edges: [{ node: { id: "1" } }, { node: { id: "2" } }],
    };
    expect(shapeConnection(conn)).toEqual({
      items: [{ id: "1" }, { id: "2" }],
      totalCount: 2,
      hasNextPage: true,
      endCursor: "CURSOR",
    });
  });

  it("handles an empty connection", () => {
    const conn = { totalCount: 0, pageInfo: { hasNextPage: false, endCursor: null }, edges: [] };
    expect(shapeConnection(conn)).toEqual({ items: [], totalCount: 0, hasNextPage: false, endCursor: null });
  });
});
