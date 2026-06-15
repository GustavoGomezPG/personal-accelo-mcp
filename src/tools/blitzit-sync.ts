import { z } from "zod";
import type { AcceloClient } from "../accelo/client.js";
import type { AcceloConfig } from "../config.js";
import type { ToolDescriptor } from "./factory.js";
import { runBlitzitSync } from "./blitzit-sync-core.js";

export function buildBlitzitSyncTool(client: AcceloClient, config: AcceloConfig): ToolDescriptor {
  return {
    name: "accelo_sync_blitzit_week",
    description:
      "Extract a week of completed Blitzit tasks (by completion date) and log them to Accelo as time entries, using a Blitzit-project→Accelo-object mapping. Preview by default; pass confirm:true to log. Skips unmapped projects, zero-duration tasks, and entries already logged in Accelo for the same day+subject.",
    inputSchema: {
      from: z.string().optional().describe("Start date YYYY-MM-DD (default Monday of current week)."),
      to: z.string().optional().describe("End date YYYY-MM-DD inclusive (default Sunday of current week)."),
      listId: z.string().optional().describe("Optional Blitzit list id to filter tasks."),
      confirm: z.boolean().optional().describe("Set true to actually log; otherwise returns a preview."),
    },
    handler: async (args) =>
      runBlitzitSync(client, config, { from: args.from, to: args.to, listId: args.listId, confirm: args.confirm, defaultRange: "week" }),
  };
}
