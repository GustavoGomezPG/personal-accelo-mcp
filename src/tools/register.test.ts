import { describe, it, expect, vi } from "vitest";
import { collectTools } from "./register.js";
import type { AcceloClient } from "../accelo/client.js";
import type { AcceloConfig } from "../config.js";

const client: AcceloClient = { query: vi.fn() as any, mutate: vi.fn() as any };
const config = { deployment: "d", sessionCookie: "c", endpoint: "e", workdayStartHour: 8 } as AcceloConfig;

describe("collectTools", () => {
  it("includes read tools plus the time-tracking and mapping-admin tools (22 total)", () => {
    const names = collectTools(client, config).map((t) => t.name).sort();
    for (const n of ["accelo_search_companies", "accelo_graphql", "accelo_log_time", "accelo_list_my_time", "accelo_edit_time", "accelo_delete_time", "accelo_sync_blitzit_week", "accelo_sync_blitzit_day", "accelo_list_mappings", "accelo_list_orphan_tasks", "accelo_update_mapping", "accelo_remove_mapping"])
      expect(names).toContain(n);
    expect(names.length).toBe(22);
  });
  it("has no duplicate names", () => {
    const names = collectTools(client, config).map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
