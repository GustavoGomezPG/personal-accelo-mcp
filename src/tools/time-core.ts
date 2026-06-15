import type { AcceloClient } from "../accelo/client.js";
import { formatDuration } from "../accelo/time.js";
import { fetchMyWorkLogs, entryEnd } from "../accelo/worklogs.js";
import { zonedDateTimeToEpoch, dayRangeEpoch, epochToHmInTz } from "../accelo/tz.js";

const LOG_MUTATION = `mutation Log($input: createWorkLogArgs!) { createWorkLogNote(input: $input) { id subject } }`;

export interface PreparedEntry {
  objectId: number;
  objectType: string;
  subject: string;
  body: string;
  seconds: number;
  billable: boolean;
  workTypeId?: number;
}

export interface ScheduleRow {
  subject: string;
  against: { id: number; type: string };
  start: string;
  end: string;
  loggedTime: string;
  billable: boolean;
}

export interface CreatedRow { id: string; subject: string; start: string; loggedTime: string }

export interface DayResult {
  resumedAfterExisting: boolean;
  schedule: ScheduleRow[];
  created: CreatedRow[] | null;
}

/** Schedule prepared entries back-to-back for one local day and optionally log them. */
export async function scheduleAndLogDay(
  client: AcceloClient,
  params: { tz: string; staffId: string; workdayStartHour: number; date: string; prepared: PreparedEntry[]; confirm: boolean },
): Promise<DayResult> {
  const { tz, staffId, workdayStartHour, date, prepared, confirm } = params;

  const workdayStart = zonedDateTimeToEpoch(date, workdayStartHour, 0, tz);
  const { start, endExclusive } = dayRangeEpoch(date, tz);
  const existing = await fetchMyWorkLogs(client, start, endExclusive, staffId);
  const latestEnd = existing.reduce((max, e) => Math.max(max, entryEnd(e)), 0);
  const resumedAfterExisting = existing.length > 0 && latestEnd > workdayStart;
  let cursor = Math.max(workdayStart, latestEnd);

  const scheduled = prepared.map((p) => {
    const startEpoch = cursor;
    cursor += p.seconds;
    return { ...p, startEpoch, endEpoch: cursor };
  });

  const schedule: ScheduleRow[] = scheduled.map((s) => ({
    subject: s.subject,
    against: { id: s.objectId, type: s.objectType },
    start: epochToHmInTz(s.startEpoch, tz),
    end: epochToHmInTz(s.endEpoch, tz),
    loggedTime: formatDuration(s.seconds),
    billable: s.billable,
  }));

  if (!confirm) return { resumedAfterExisting, schedule, created: null };

  const created: CreatedRow[] = [];
  for (const s of scheduled) {
    const input: Record<string, unknown> = {
      workLogAgainstObject: { id: s.objectId, type: s.objectType },
      workLogSubject: s.subject,
      workLogBody: s.body,
      workLogLoggedTime: s.seconds,
      workLogIsBillable: s.billable,
      workLogDate: s.startEpoch,
    };
    if (s.workTypeId !== undefined) input.workLogClassId = s.workTypeId;
    const data = await client.mutate<{ createWorkLogNote: { id: string; subject: string } }>(LOG_MUTATION, { input });
    created.push({ id: data.createWorkLogNote.id, subject: data.createWorkLogNote.subject, start: epochToHmInTz(s.startEpoch, tz), loggedTime: formatDuration(s.seconds) });
  }
  return { resumedAfterExisting, schedule, created };
}
