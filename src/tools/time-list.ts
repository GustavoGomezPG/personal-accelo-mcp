import { z } from "zod";
import type { AcceloClient } from "../accelo/client.js";
import type { ToolDescriptor } from "./factory.js";
import { text } from "./util.js";
import { dateStartEpochUTC, epochToDateStringUTC, currentWeekRange } from "../accelo/dates.js";
import { formatDuration } from "../accelo/time.js";
import { getCurrentUser } from "../accelo/identity.js";
import { fetchMyWorkLogs } from "../accelo/worklogs.js";

export function buildListTimeTool(client: AcceloClient): ToolDescriptor {
  return {
    name: "accelo_list_my_time",
    description: "List your own time entries for a date range (default current week, Mon–Sun). Read-only.",
    inputSchema: {
      from: z.string().optional().describe("Start date YYYY-MM-DD (default Monday of current week)."),
      to: z.string().optional().describe("End date YYYY-MM-DD inclusive (default Sunday of current week)."),
      first: z.number().int().positive().optional().describe("Max entries (default 50, max 100)."),
    },
    handler: async (args) => {
      const week = currentWeekRange();
      const from = args.from ?? week.from;
      const to = args.to ?? week.to;
      const first = Math.min(Math.max(args.first ?? 50, 1), 100);

      const user = await getCurrentUser(client);
      const fromEpoch = dateStartEpochUTC(from);
      const toExclusive = dateStartEpochUTC(to) + 86400;
      const entries = await fetchMyWorkLogs(client, fromEpoch, toExclusive, user.staffId, first);

      const items = entries.map((e) => ({
        id: e.id,
        date: epochToDateStringUTC(e.startEpoch),
        subject: e.subject,
        billable: formatDuration(e.billable),
        nonbillable: formatDuration(e.nonbillable),
        against: e.against,
      }));
      const totalBillable = formatDuration(entries.reduce((s, e) => s + e.billable, 0));
      return text({ from, to, count: items.length, totalBillable, items });
    },
  };
}
