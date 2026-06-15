import { z } from "zod";
import type { AcceloClient } from "../accelo/client.js";
import type { ToolDescriptor } from "./factory.js";

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

const ROOT_FIELDS_QUERY = `query Root {
  __schema { queryType { fields { name description args { name } } } }
}`;

const TYPE_QUERY = `query TypeInfo($name:String!) {
  __type(name:$name) {
    name kind description
    fields { name description type { name kind ofType { name kind ofType { name } } } }
    inputFields { name type { name kind ofType { name kind ofType { name } } } }
    enumValues { name }
  }
}`;

export function buildExtraTools(client: AcceloClient): ToolDescriptor[] {
  const graphqlTool: ToolDescriptor = {
    name: "accelo_graphql",
    description:
      "Run an arbitrary read-only Accelo GraphQL query. Mutations and subscriptions are rejected. Use accelo_introspect to discover fields.",
    inputSchema: {
      query: z.string().describe("A GraphQL query document (query operation only)."),
      variables: z.record(z.unknown()).optional().describe("Optional variables object."),
    },
    handler: async (args) => text(await client.query(args.query, args.variables ?? {})),
  };

  const introspectTool: ToolDescriptor = {
    name: "accelo_introspect",
    description:
      "Introspect the Accelo GraphQL schema. With no argument, lists root Query fields. With typeName, returns that type's fields, input fields, and enum values.",
    inputSchema: {
      typeName: z.string().optional().describe("A GraphQL type name to describe (e.g. 'Company')."),
    },
    handler: async (args) => {
      if (args.typeName) return text(await client.query(TYPE_QUERY, { name: args.typeName }));
      return text(await client.query(ROOT_FIELDS_QUERY));
    },
  };

  return [graphqlTool, introspectTool];
}
