import { describe, it, expect } from "vitest";
import { assertReadOnly } from "./readonly.js";

describe("assertReadOnly", () => {
  it("accepts a named query", () => {
    expect(() => assertReadOnly("query Q { companies(filters:[{}]) { totalCount } }")).not.toThrow();
  });

  it("accepts shorthand query", () => {
    expect(() => assertReadOnly("{ companies(filters:[{}]) { totalCount } }")).not.toThrow();
  });

  it("rejects a mutation", () => {
    expect(() => assertReadOnly("mutation M { deleteCompany(id: 1) { id } }")).toThrow(/read-only/i);
  });

  it("rejects a subscription", () => {
    expect(() => assertReadOnly("subscription S { events { id } }")).toThrow(/read-only/i);
  });

  it("rejects when any operation in a multi-op document is a mutation", () => {
    expect(() => assertReadOnly("query Q { a } mutation M { b }")).toThrow(/read-only/i);
  });

  it("throws a clear error on unparseable input", () => {
    expect(() => assertReadOnly("this is not graphql {{{")).toThrow(/parse/i);
  });
});
