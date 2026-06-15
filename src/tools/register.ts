import type { AcceloClient } from "../accelo/client.js";
import { ENTITIES } from "../accelo/entities.js";
import { buildEntityTools, type ToolDescriptor } from "./factory.js";
import { buildExtraTools } from "./extras.js";

export function collectTools(client: AcceloClient): ToolDescriptor[] {
  const entityTools = ENTITIES.flatMap((entity) => buildEntityTools(entity, client));
  return [...entityTools, ...buildExtraTools(client)];
}
