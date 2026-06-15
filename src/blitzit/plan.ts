import { buildSubject } from "../accelo/nomenclature.js";
import { epochToDateInTz } from "../accelo/tz.js";
import type { PreparedEntry } from "../tools/time-core.js";
import type { BlitzitTask } from "./tasks.js";
import { resolveMapping, type Mapping } from "./mapping.js";

export interface DayPlan { date: string; prepared: PreparedEntry[] }
export interface SyncPlan {
  days: DayPlan[];
  unmapped: Array<{ project: string; count: number }>;
  skippedZero: Array<{ id: string; project: string }>;
  skippedDuplicates: Array<{ date: string; subject: string }>;
}

export const DEDUP_SEP = " ";

export function planSync(params: {
  tasks: BlitzitTask[];
  mapping: Mapping;
  existingKeys: Set<string>; // `${date}${DEDUP_SEP}${subject}`
  tz: string;
}): SyncPlan {
  const { tasks, mapping, existingKeys, tz } = params;
  const byDay = new Map<string, PreparedEntry[]>();
  const unmappedCounts = new Map<string, number>();
  const skippedZero: SyncPlan["skippedZero"] = [];
  const skippedDuplicates: SyncPlan["skippedDuplicates"] = [];

  for (const t of [...tasks].sort((a, b) => a.endTimeMs - b.endTimeMs)) {
    const entry = resolveMapping(mapping, t.project);
    if (!entry) { unmappedCounts.set(t.project, (unmappedCounts.get(t.project) ?? 0) + 1); continue; }
    if (t.seconds <= 0) { skippedZero.push({ id: t.id, project: t.project }); continue; }

    const topic = t.topic || "General";
    const detail = t.detail || t.topic || t.project;
    const subject = buildSubject(t.project, topic, detail);
    const date = epochToDateInTz(Math.floor(t.endTimeMs / 1000), tz);

    if (existingKeys.has(`${date}${DEDUP_SEP}${subject}`)) { skippedDuplicates.push({ date, subject }); continue; }

    const prepared: PreparedEntry = {
      objectId: entry.objectId,
      objectType: entry.objectType,
      subject,
      body: detail,
      seconds: t.seconds,
      billable: entry.billable ?? true,
      workTypeId: entry.workTypeId,
    };
    if (!byDay.has(date)) byDay.set(date, []);
    byDay.get(date)!.push(prepared);
  }

  const days: DayPlan[] = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, prepared]) => ({ date, prepared }));
  const unmapped = [...unmappedCounts.entries()].map(([project, count]) => ({ project, count }));
  return { days, unmapped, skippedZero, skippedDuplicates };
}
