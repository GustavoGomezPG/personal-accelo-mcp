import { z } from "zod";
import type { AcceloClient } from "../accelo/client.js";
import type { EntityConfig } from "../accelo/entities.js";
import { buildSearchQuery, buildGetByIdQuery, buildFilterBlock } from "../accelo/queries.js";
import { shapeConnection, type Connection } from "../accelo/shape.js";

export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, z.ZodTypeAny>;
  handler: (args: any) => Promise<{ content: Array<{ type: "text"; text: string }> }>;
}

function text(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export function buildEntityTools(entity: EntityConfig, client: AcceloClient): ToolDescriptor[] {
  const searchSchema: Record<string, z.ZodTypeAny> = {
    search: z.string().optional().describe(`Free-text search on ${entity.searchLabel} (contains).`),
    first: z.number().int().positive().optional().describe("Max items to return (default 20, max 100)."),
    after: z.string().optional().describe("Pagination cursor (endCursor from a previous call)."),
    sortKey: z.string().optional().describe(`Sort key enum (default ${entity.defaultSort.key}).`),
    sortOrder: z.enum(["ASC", "DESC"]).optional().describe(`Sort order (default ${entity.defaultSort.order}).`),
  };
  for (const f of entity.intFilters) {
    searchSchema[f.param] = z.number().int().optional().describe(f.description);
  }

  const searchQuery = buildSearchQuery(entity);
  const getQuery = buildGetByIdQuery(entity);

  const searchTool: ToolDescriptor = {
    name: `accelo_search_${entity.key}`,
    description: `Search Accelo ${entity.key}. Supports free-text on ${entity.searchLabel}, id filters, sorting and pagination. Read-only.`,
    inputSchema: searchSchema,
    handler: async (args) => {
      const first = Math.min(Math.max(args.first ?? 20, 1), 100);
      const filters = buildFilterBlock(entity, args);
      const sort = [
        {
          key: args.sortKey ?? entity.defaultSort.key,
          order: args.sortOrder ?? entity.defaultSort.order,
        },
      ];
      const data = await client.query<Record<string, Connection<unknown>>>(searchQuery, {
        filters,
        sort,
        first,
        after: args.after,
      });
      return text(shapeConnection(data[entity.rootField]));
    },
  };

  const getTool: ToolDescriptor = {
    name: `accelo_get_${entity.singular}`,
    description: `Fetch a single Accelo ${entity.singular} by numeric id. Read-only.`,
    inputSchema: { id: z.number().int().describe(`The ${entity.singular} id.`) },
    handler: async (args) => {
      const filters = [{ ints: [{ key: entity.idKey, type: "equals", value: args.id }] }];
      const data = await client.query<Record<string, { edges: Array<{ node: unknown }> }>>(getQuery, { filters });
      const node = data[entity.rootField]?.edges?.[0]?.node ?? null;
      return text(node);
    },
  };

  return [searchTool, getTool];
}
