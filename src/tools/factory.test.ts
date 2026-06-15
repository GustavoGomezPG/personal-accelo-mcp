import { describe, it, expect, vi } from "vitest";
import { buildEntityTools } from "./factory.js";
import { ENTITIES } from "../accelo/entities.js";
import type { AcceloClient } from "../accelo/client.js";

const companies = ENTITIES.find((e) => e.key === "companies")!;

function fakeClient(data: unknown): AcceloClient {
  return { query: vi.fn().mockResolvedValue(data) as any };
}

describe("buildEntityTools", () => {
  it("creates a search and a get tool with expected names", () => {
    const tools = buildEntityTools(companies, fakeClient({}));
    const names = tools.map((t) => t.name);
    expect(names).toContain("accelo_search_companies");
    expect(names).toContain("accelo_get_company");
  });

  it("search tool calls the client with filters/sort/paging and returns a shaped list", async () => {
    const client = fakeClient({
      companies: {
        totalCount: 1,
        pageInfo: { hasNextPage: false, endCursor: null },
        edges: [{ node: { id: "7", name: "Acme" } }],
      },
    });
    const search = buildEntityTools(companies, client).find((t) => t.name === "accelo_search_companies")!;
    const result = await search.handler({ search: "Acme", first: 10 });

    const payload = JSON.parse(result.content[0].text);
    expect(payload.items).toEqual([{ id: "7", name: "Acme" }]);
    expect(payload.totalCount).toBe(1);

    const [, variables] = (client.query as any).mock.calls[0];
    expect(variables.filters).toEqual([{ texts: [{ key: "CompanyName", type: "contains", value: "Acme" }] }]);
    expect(variables.sort).toEqual({ key: "CompanyName", order: "ASC" });
    expect(variables.first).toBe(10);
  });

  it("search tool clamps first to 100 and defaults to 20", async () => {
    const client = fakeClient({
      companies: { totalCount: 0, pageInfo: { hasNextPage: false, endCursor: null }, edges: [] },
    });
    const search = buildEntityTools(companies, client).find((t) => t.name === "accelo_search_companies")!;

    await search.handler({});
    expect((client.query as any).mock.calls[0][1].first).toBe(20);

    await search.handler({ first: 500 });
    expect((client.query as any).mock.calls[1][1].first).toBe(100);
  });

  it("get tool fetches by id and returns the single node (or null)", async () => {
    const client = fakeClient({ companies: { edges: [{ node: { id: "7", name: "Acme" } }] } });
    const get = buildEntityTools(companies, client).find((t) => t.name === "accelo_get_company")!;
    const result = await get.handler({ id: 7 });

    const payload = JSON.parse(result.content[0].text);
    expect(payload).toEqual({ id: "7", name: "Acme" });

    const [, variables] = (client.query as any).mock.calls[0];
    expect(variables.filters).toEqual([{ ints: [{ key: "CompanyId", type: "equals", value: 7 }] }]);
  });

  it("get tool returns null when nothing matches", async () => {
    const client = fakeClient({ companies: { edges: [] } });
    const get = buildEntityTools(companies, client).find((t) => t.name === "accelo_get_company")!;
    const result = await get.handler({ id: 999 });
    expect(JSON.parse(result.content[0].text)).toBeNull();
  });
});
