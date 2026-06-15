import { describe, it, expect } from "vitest";
import { buildSearchQuery, buildFilterBlock } from "./queries.js";
import { ENTITIES } from "./entities.js";

const companies = ENTITIES.find((e) => e.key === "companies")!;

describe("buildFilterBlock", () => {
  it("returns a single empty block when no search/filters provided", () => {
    expect(buildFilterBlock(companies, {})).toEqual([{}]);
  });

  it("adds a text 'contains' filter for search", () => {
    expect(buildFilterBlock(companies, { search: "acme" })).toEqual([
      { texts: [{ key: "CompanyName", type: "contains", value: "acme" }] },
    ]);
  });

  it("adds int filters for known params", () => {
    expect(buildFilterBlock(companies, { statusId: 3 })).toEqual([
      { ints: [{ key: "CompanyStatusId", type: "equals", value: 3 }] },
    ]);
  });

  it("combines search and int filters into one block", () => {
    expect(buildFilterBlock(companies, { search: "acme", statusId: 3 })).toEqual([
      {
        texts: [{ key: "CompanyName", type: "contains", value: "acme" }],
        ints: [{ key: "CompanyStatusId", type: "equals", value: 3 }],
      },
    ]);
  });
});

describe("buildSearchQuery", () => {
  it("produces a valid read-only query naming the connection and selection", () => {
    const q = buildSearchQuery(companies);
    expect(q).toContain("companies(filters:$filters");
    expect(q).toContain("$filters:[companiesFilterAndBlockInput!]!");
    expect(q).toContain("$sort:companiesSortFieldInput");
    expect(q).toContain("totalCount");
    expect(q).toContain("pageInfo { hasNextPage endCursor }");
    expect(q).toContain("name"); // from the company selection
    expect(q.trim().startsWith("query")).toBe(true);
  });
});
