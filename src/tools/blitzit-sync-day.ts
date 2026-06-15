import { z } from "zod";
import type { AcceloClient } from "../accelo/client.js";
import type { AcceloConfig } from "../config.js";
import type { ToolDescriptor } from "./factory.js";
import { runBlitzitSync } from "./blitzit-sync-core.js";

export function buildBlitzitSyncDayTool(client: AcceloClient, config: AcceloConfig): ToolDescriptor {
  return {
    name: "accelo_sync_blitzit_day",
    description:
      "Sync a single day of completed Blitzit tasks to Accelo as time entries (default today, in your timezone). Use this for requests like 'sync my day to accelo'. Preview by default; pass confirm:true to log. Skips unmapped projects, zero-duration tasks, and entries already logged in Accelo for the same day+subject.",
    inputSchema: {
      date: z.string().optional().describe("Day to sync, YYYY-MM-DD (default today in your timezone)."),
      listId: z.string().optional().describe("Optional Blitzit list id to filter tasks."),
      confirm: z.boolean().optional().describe("Set true to actually log; otherwise returns a preview."),
    },
    handler: async (args) =>
      runBlitzitSync(client, config, { from: args.date, to: args.date, listId: args.listId, confirm: args.confirm, defaultRange: "day" }),
  };
}
