export interface Connection<T> {
  totalCount: number;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  edges: Array<{ node: T }>;
}

export interface ShapedList<T> {
  items: T[];
  totalCount: number;
  hasNextPage: boolean;
  endCursor: string | null;
}

export function shapeConnection<T>(conn: Connection<T>): ShapedList<T> {
  return {
    items: conn.edges.map((e) => e.node),
    totalCount: conn.totalCount,
    hasNextPage: conn.pageInfo.hasNextPage,
    endCursor: conn.pageInfo.endCursor,
  };
}
