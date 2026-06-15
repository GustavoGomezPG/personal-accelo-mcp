import { z } from "zod";
import type { AcceloClient } from "../accelo/client.js";
import type { AcceloConfig } from "../config.js";
import type { ToolDescriptor } from "./factory.js";
import { text } from "./util.js";
import { getCurrentUser } from "../accelo/identity.js";
import { fetchMyWorkLogs } from "../accelo/worklogs.js";
import { currentWeekRangeInTz } from "../accelo/dates.js";
import { zonedDateTimeToEpoch, epochToDateInTz } from "../accelo/tz.js";
import { scheduleAndLogDay } from "./time-core.js";
import { getBlitzitAuth } from "../blitzit/auth.js";
import { createBlitzitClient } from "../blitzit/client.js";
import { fetchWeekDoneTasks } from "../blitzit/tasks.js";
import { loadMapping } from "../blitzit/mapping.js";
import { planSync, DEDUP_SEP } from "../blitzit/plan.js";

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
    handler: async (args) => {
      const user = await getCurrentUser(client);
      const tz = config.workdayTz ?? user.timezone ?? "UTC";

      const week = currentWeekRangeInTz(tz);
      const from = args.from ?? week.from;
      const to = args.to ?? week.to;

      // Blitzit task window in the user's timezone (endTime is absolute ms).
      const fromMs = zonedDateTimeToEpoch(from, 0, 0, tz) * 1000;
      const toMs = (zonedDateTimeToEpoch(to, 0, 0, tz) + 86400) * 1000; // exclusive end of `to`

      const { idToken, uid } = await getBlitzitAuth();
      const tasks = await fetchWeekDoneTasks(createBlitzitClient(idToken), uid, fromMs, toMs, args.listId);

      const mapping = loadMapping();

      // Existing Accelo entries across the week → dedup keys "date subject".
      const fromEpoch = zonedDateTimeToEpoch(from, 0, 0, tz);
      const toEpochExclusive = zonedDateTimeToEpoch(to, 0, 0, tz) + 86400;
      // Dedup against existing Accelo notes for the week. Capped at 100 entries/week (fetchMyWorkLogs max); a single user's week is well under this.
      const existing = await fetchMyWorkLogs(client, fromEpoch, toEpochExclusive, user.staffId, 100);
      const existingKeys = new Set(existing.map((e) => `${epochToDateInTz(e.startEpoch, tz)}${DEDUP_SEP}${e.subject}`));

      const plan = planSync({ tasks, mapping, existingKeys, tz });

      const confirm = !!args.confirm;
      const days: Array<Record<string, unknown>> = [];
      for (const day of plan.days) {
        const r = await scheduleAndLogDay(client, {
          tz, staffId: user.staffId, workdayStartHour: config.workdayStartHour, date: day.date, prepared: day.prepared, confirm,
        });
        days.push(confirm
          ? { date: day.date, logged: r.created?.length ?? 0, created: r.created }
          : { date: day.date, entries: r.schedule });
      }

      return text({
        mode: confirm ? "logged" : "preview",
        from, to, tz,
        taskCount: tasks.length,
        days,
        unmapped: plan.unmapped,
        skippedZero: plan.skippedZero,
        skippedDuplicates: plan.skippedDuplicates,
        ...(confirm ? {} : { willLog: "Set confirm:true to log these entries." }),
      });
    },
  };
}
