import type { EntityConfig } from "./entities.js";

export interface SearchArgs {
  search?: string;
  [intParam: string]: unknown;
}

type FilterBlock = {
  texts?: Array<{ key: string; type: string; value: string }>;
  ints?: Array<{ key: string; type: string; value: number }>;
};

export function buildFilterBlock(entity: EntityConfig, args: SearchArgs): FilterBlock[] {
  const block: FilterBlock = {};
  if (typeof args.search === "string" && args.search.length > 0) {
    block.texts = [{ key: entity.searchTextKey, type: "contains", value: args.search }];
  }
  const ints: Array<{ key: string; type: string; value: number }> = [];
  for (const f of entity.intFilters) {
    const v = args[f.param];
    if (typeof v === "number") ints.push({ key: f.key, type: "equals", value: v });
  }
  if (ints.length > 0) block.ints = ints;
  return [block];
}

export function buildSearchQuery(entity: EntityConfig): string {
  const filterType = `${entity.rootField}FilterAndBlockInput`;
  const sortType = `${entity.rootField}SortFieldInput`;
  return `query Search($filters:[${filterType}!]!, $sort:[${sortType}!], $first:Int, $after:String) {
  ${entity.rootField}(filters:$filters, sort:$sort, first:$first, after:$after) {
    totalCount
    pageInfo { hasNextPage endCursor }
    edges { node {${entity.selection}} }
  }
}`;
}

export function buildGetByIdQuery(entity: EntityConfig): string {
  const filterType = `${entity.rootField}FilterAndBlockInput`;
  return `query GetById($filters:[${filterType}!]!) {
  ${entity.rootField}(filters:$filters, first:1) {
    edges { node {${entity.selection}} }
  }
}`;
}
