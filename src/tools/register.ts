import type { AcceloClient } from "../accelo/client.js";
import type { AcceloConfig } from "../config.js";
import { ENTITIES } from "../accelo/entities.js";
import { buildEntityTools, type ToolDescriptor } from "./factory.js";
import { buildExtraTools } from "./extras.js";
import { buildLogTimeTool } from "./time-log.js";
import { buildListTimeTool } from "./time-list.js";
import { buildEditTimeTool } from "./time-edit.js";
import { buildDeleteTimeTool } from "./time-delete.js";
import { buildBlitzitSyncTool } from "./blitzit-sync.js";

export function collectTools(client: AcceloClient, config: AcceloConfig): ToolDescriptor[] {
  const entityTools = ENTITIES.flatMap((entity) => buildEntityTools(entity, client));
  const timeTools = [
    buildLogTimeTool(client, config),
    buildListTimeTool(client),
    buildEditTimeTool(client),
    buildDeleteTimeTool(client),
    buildBlitzitSyncTool(client, config),
  ];
  return [...entityTools, ...buildExtraTools(client), ...timeTools];
}
