import { parse } from "graphql";

export function assertReadOnly(query: string): void {
  let doc;
  try {
    doc = parse(query);
  } catch (e) {
    throw new Error(`Could not parse GraphQL query: ${(e as Error).message}`);
  }
  for (const def of doc.definitions) {
    if (def.kind === "OperationDefinition" && def.operation !== "query") {
      throw new Error(
        `This MCP is read-only; ${def.operation} operations are not allowed. Only 'query' is permitted.`,
      );
    }
  }
}
