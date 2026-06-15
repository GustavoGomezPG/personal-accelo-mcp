import { z } from "zod";
import type { AcceloClient } from "../accelo/client.js";
import type { AcceloConfig } from "../config.js";
import type { ToolDescriptor } from "./factory.js";
import { text } from "./util.js";
import { parseDuration } from "../accelo/time.js";
import { buildSubject } from "../accelo/nomenclature.js";
import { getCurrentUser } from "../accelo/identity.js";
import { todayInTz } from "../accelo/tz.js";
import { scheduleAndLogDay, type PreparedEntry } from "./time-core.js";

const OBJECT_TYPES = ["task", "ticket", "project", "milestone", "retainer", "sale"] as const;

const entrySchema = z.object({
  objectId: z.number().int().describe("Object id to log against (usually a task id)."),
  objectType: z.enum(OBJECT_TYPES).optional().describe("Object type (default 'task')."),
  projectLabel: z.string().describe("Nomenclature segment 1, e.g. 'OptimizedIT'."),
  topic: z.string().describe("Nomenclature segment 2, e.g. 'Website'."),
  description: z.string().describe("Nomenclature segment 3 — what you did."),
  time: z.string().describe("Duration: '2h', '45m', '1.5h', or '1:30'."),
  billable: z.boolean().optional().describe("Billable? (default true)."),
  workTypeId: z.number().int().optional().describe("Optional work type / class id."),
});

export function buildLogTimeTool(client: AcceloClient, config: AcceloConfig): ToolDescriptor {
  return {
    name: "accelo_log_time",
    description:
      "Log one or more time entries for a single day, sequenced with no overlap (starts at the workday start, default 8am, then back-to-back; resumes after entries already logged that day). Uses the 'Project :: Topic :: Description' nomenclature. Preview by default; pass confirm:true to log.",
    inputSchema: {
      date: z.string().optional().describe("Day for all entries, YYYY-MM-DD (default today in your timezone)."),
      entries: z.array(entrySchema).min(1).describe("Ordered list of entries; start times follow this order."),
      confirm: z.boolean().optional().describe("Set true to actually log; otherwise returns the schedule preview."),
    },
    handler: async (args) => {
      const prepared: PreparedEntry[] = (args.entries as Array<z.infer<typeof entrySchema>>).map((e) => ({
        objectId: e.objectId,
        objectType: e.objectType ?? "task",
        subject: buildSubject(e.projectLabel, e.topic, e.description),
        body: e.description,
        seconds: parseDuration(e.time),
        billable: e.billable ?? true,
        workTypeId: e.workTypeId,
      }));

      const user = await getCurrentUser(client);
      const tz = config.workdayTz ?? user.timezone ?? "UTC";
      const date = args.date ?? todayInTz(tz);

      const r = await scheduleAndLogDay(client, {
        tz, staffId: user.staffId, workdayStartHour: config.workdayStartHour, date, prepared, confirm: !!args.confirm,
      });

      if (!args.confirm) {
        return text({ preview: true, date, tz, resumedAfterExisting: r.resumedAfterExisting, willLog: "Set confirm:true to log these entries.", entries: r.schedule });
      }
      return text({ logged: true, date, tz, resumedAfterExisting: r.resumedAfterExisting, created: r.created });
    },
  };
}
