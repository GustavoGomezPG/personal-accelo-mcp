import { describe, it, expect, vi } from "vitest";
import { buildExtraTools } from "./extras.js";
import type { AcceloClient } from "../accelo/client.js";

function fakeClient(impl: (q: string, v?: any) => any): AcceloClient {
  return { query: vi.fn(impl) as any };
}

describe("buildExtraTools", () => {
  it("exposes accelo_graphql and accelo_introspect", () => {
    const names = buildExtraTools(fakeClient(() => ({}))).map((t) => t.name);
    expect(names).toEqual(["accelo_graphql", "accelo_introspect"]);
  });

  it("accelo_graphql passes the query and variables to the client", async () => {
    const client = fakeClient(() => ({ ok: 1 }));
    const tool = buildExtraTools(client).find((t) => t.name === "accelo_graphql")!;
    const out = await tool.handler({ query: "{ ok }", variables: { a: 1 } });
    expect(JSON.parse(out.content[0].text)).toEqual({ ok: 1 });
    expect((client.query as any).mock.calls[0]).toEqual(["{ ok }", { a: 1 }]);
  });

  it("accelo_introspect lists root query fields when no typeName given", async () => {
    const client = fakeClient(() => ({ __schema: { queryType: { fields: [{ name: "companies" }] } } }));
    const tool = buildExtraTools(client).find((t) => t.name === "accelo_introspect")!;
    const out = await tool.handler({});
    const sent = (client.query as any).mock.calls[0][0] as string;
    expect(sent).toContain("queryType");
    expect(JSON.parse(out.content[0].text)).toMatchObject({ __schema: { queryType: { fields: [{ name: "companies" }] } } });
  });

  it("accelo_introspect describes a named type", async () => {
    const client = fakeClient(() => ({ __type: { name: "Company", fields: [] } }));
    const tool = buildExtraTools(client).find((t) => t.name === "accelo_introspect")!;
    await tool.handler({ typeName: "Company" });
    const [q, v] = (client.query as any).mock.calls[0];
    expect(q).toContain("__type(name:$name)");
    expect(v).toEqual({ name: "Company" });
  });
});
