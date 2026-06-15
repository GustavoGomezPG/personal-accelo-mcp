import type { AcceloClient } from "../accelo/client.js";
import type { AcceloConfig } from "../config.js";
import { text } from "./util.js";
import { getCurrentUser } from "../accelo/identity.js";
import { fetchMyWorkLogs } from "../accelo/worklogs.js";
import { currentWeekRangeInTz } from "../accelo/dates.js";
import { zonedDateTimeToEpoch, epochToDateInTz, todayInTz } from "../accelo/tz.js";
import { scheduleAndLogDay } from "./time-core.js";
import { getBlitzitAuth } from "../blitzit/auth.js";
import { createBlitzitClient } from "../blitzit/client.js";
import { fetchWeekDoneTasks } from "../blitzit/tasks.js";
import { loadMapping } from "../blitzit/mapping.js";
import { planSync, DEDUP_SEP } from "../blitzit/plan.js";

/** Shared engine for the week and day Blitzit→Accelo sync tools. */
export async function runBlitzitSync(
  client: AcceloClient,
  config: AcceloConfig,
  opts: { from?: string; to?: string; listId?: string; confirm?: boolean; defaultRange: "week" | "day" },
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const user = await getCurrentUser(client);
  const tz = config.workdayTz ?? user.timezone ?? "UTC";

  let from: string;
  let to: string;
  if (opts.from && opts.to) {
    from = opts.from;
    to = opts.to;
  } else if (opts.defaultRange === "day") {
    from = to = opts.from ?? opts.to ?? todayInTz(tz);
  } else {
    const week = currentWeekRangeInTz(tz);
    from = opts.from ?? week.from;
    to = opts.to ?? week.to;
  }

  const fromMs = zonedDateTimeToEpoch(from, 0, 0, tz) * 1000;
  const toMs = (zonedDateTimeToEpoch(to, 0, 0, tz) + 86400) * 1000; // exclusive end of `to`

  const { idToken, uid } = await getBlitzitAuth();
  const tasks = await fetchWeekDoneTasks(createBlitzitClient(idToken), uid, fromMs, toMs, opts.listId);

  const mapping = loadMapping();

  // Dedup against existing Accelo notes for the range. Capped at 100 entries (fetchMyWorkLogs max); a single user's week is well under this.
  const fromEpoch = zonedDateTimeToEpoch(from, 0, 0, tz);
  const toEpochExclusive = zonedDateTimeToEpoch(to, 0, 0, tz) + 86400;
  const existing = await fetchMyWorkLogs(client, fromEpoch, toEpochExclusive, user.staffId, 100);
  const existingKeys = new Set(existing.map((e) => `${epochToDateInTz(e.startEpoch, tz)}${DEDUP_SEP}${e.subject}`));

  const plan = planSync({ tasks, mapping, existingKeys, tz });

  const confirm = !!opts.confirm;
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
}
