import { describe, it, expect, vi } from "vitest";
import { createClient } from "./client.js";
import type { AcceloConfig } from "../config.js";

const config = { deployment: "demo", sessionCookie: "C", endpoint: "https://demo.accelo.com/graphql", workdayStartHour: 8 } as AcceloConfig;
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("client.mutate", () => {
  it("sends a mutation (bypassing the guard) and returns data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { createWorkLogNote: { id: "1" } } }));
    const client = createClient(config, fetchMock);
    const data = await client.mutate("mutation($i:X!){ createWorkLogNote(input:$i){ id } }", { i: { a: 1 } });
    expect(data).toEqual({ createWorkLogNote: { id: "1" } });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).query).toContain("mutation");
  });

  it("query() still rejects a mutation and never fetches", async () => {
    const fetchMock = vi.fn();
    const client = createClient(config, fetchMock);
    await expect(client.query("mutation { x }")).rejects.toThrow(/read-only/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mutate maps a GraphQL error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ errors: [{ message: "nope" }] }));
    const client = createClient(config, fetchMock);
    await expect(client.mutate("mutation { x }")).rejects.toMatchObject({ code: "GRAPHQL_ERROR" });
  });
});
