import { describe, it, expect, vi } from "vitest";
import { createClient, AcceloError } from "./client.js";
import type { AcceloConfig } from "../config.js";

const config: AcceloConfig = {
  deployment: "demo",
  sessionCookie: "COOKIEVAL",
  endpoint: "https://demo.accelo.com/graphql",
  workdayStartHour: 8,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createClient", () => {
  it("posts to the endpoint with cookie + csrf headers and returns data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { ok: 1 } }));
    const client = createClient(config, fetchMock);
    const data = await client.query("{ ok }");

    expect(data).toEqual({ ok: 1 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://demo.accelo.com/graphql");
    expect(init.method).toBe("POST");
    expect(init.headers["Cookie"]).toBe("AFFINITYLIVE=COOKIEVAL");
    expect(init.headers["X-CSRF-REQUESTED"]).toBe("1");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ query: "{ ok }", variables: {} });
  });

  it("passes variables through", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: {} }));
    const client = createClient(config, fetchMock);
    await client.query("query($id:Int){ x }", { id: 5 });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).variables).toEqual({ id: 5 });
  });

  it("refuses to send a mutation (read-only guard)", async () => {
    const fetchMock = vi.fn();
    const client = createClient(config, fetchMock);
    await expect(client.query("mutation { x }")).rejects.toThrow(/read-only/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps a 403 to SESSION_EXPIRED", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("forbidden", { status: 403 }));
    const client = createClient(config, fetchMock);
    await expect(client.query("{ x }")).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
  });

  it("maps an HTML login response to SESSION_EXPIRED", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("<html>login</html>", { status: 200, headers: { "content-type": "text/html" } }),
    );
    const client = createClient(config, fetchMock);
    await expect(client.query("{ x }")).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
  });

  it("surfaces GraphQL errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ errors: [{ message: "Field x not found", path: ["x"] }] }),
    );
    const client = createClient(config, fetchMock);
    await expect(client.query("{ x }")).rejects.toMatchObject({ code: "GRAPHQL_ERROR" });
  });
});
