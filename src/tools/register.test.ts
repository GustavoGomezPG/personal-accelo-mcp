import { describe, it, expect, vi } from "vitest";
import { collectTools } from "./register.js";
import type { AcceloClient } from "../accelo/client.js";
import type { AcceloConfig } from "../config.js";

const client: AcceloClient = { query: vi.fn() as any, mutate: vi.fn() as any };
const config = { deployment: "d", sessionCookie: "c", endpoint: "e", workdayStartHour: 8 } as AcceloConfig;

describe("collectTools", () => {
  it("includes read tools plus the four time-tracking tools (17 total)", () => {
    const names = collectTools(client, config).map((t) => t.name).sort();
    for (const n of ["accelo_search_companies", "accelo_graphql", "accelo_log_time", "accelo_list_my_time", "accelo_edit_time", "accelo_delete_time", "accelo_sync_blitzit_week"])
      expect(names).toContain(n);
    expect(names.length).toBe(17);
  });
  it("has no duplicate names", () => {
    const names = collectTools(client, config).map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
