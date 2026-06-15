import { describe, it, expect, vi } from "vitest";
import { collectTools } from "./register.js";
import type { AcceloClient } from "../accelo/client.js";

const client: AcceloClient = { query: vi.fn() as any, mutate: vi.fn() as any };

describe("collectTools", () => {
  it("includes search+get for all 5 entities plus 2 extra tools", () => {
    const names = collectTools(client).map((t) => t.name).sort();
    expect(names).toContain("accelo_search_companies");
    expect(names).toContain("accelo_get_company");
    expect(names).toContain("accelo_search_tasks");
    expect(names).toContain("accelo_get_ticket");
    expect(names).toContain("accelo_graphql");
    expect(names).toContain("accelo_introspect");
    // 5 entities * 2 tools + 2 extras = 12
    expect(names.length).toBe(12);
  });

  it("has no duplicate tool names", () => {
    const names = collectTools(client).map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
