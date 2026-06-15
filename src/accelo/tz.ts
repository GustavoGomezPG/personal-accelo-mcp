function partsInTz(epochMs: number, tz: string): Record<string, number> {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p: Record<string, number> = {};
  for (const part of dtf.formatToParts(new Date(epochMs))) if (part.type !== "literal") p[part.type] = Number(part.value);
  return p;
}

/** Offset (ms) such that local-wallclock-as-UTC === epoch + offset. */
function tzOffsetMs(epochMs: number, tz: string): number {
  const p = partsInTz(epochMs, tz);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUTC - epochMs;
}

function ymd(date: string): { y: number; m: number; d: number } {
  const m = date.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`Invalid date: "${date}". Use YYYY-MM-DD.`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** Epoch (seconds) for a wall-clock date/time in `tz`. */
export function zonedDateTimeToEpoch(date: string, hour: number, minute: number, tz: string): number {
  const { y, m, d } = ymd(date);
  const guess = Date.UTC(y, m - 1, d, hour, minute, 0);
  let epochMs = guess - tzOffsetMs(guess, tz);
  const refined = tzOffsetMs(epochMs, tz);           // second pass handles DST edges
  epochMs = guess - refined;
  return Math.floor(epochMs / 1000);
}

/** [start, endExclusive) epochs (seconds) for the local day in `tz`. */
export function dayRangeEpoch(date: string, tz: string): { start: number; endExclusive: number } {
  const start = zonedDateTimeToEpoch(date, 0, 0, tz);
  const next = new Date(zonedDateTimeToEpoch(date, 0, 0, tz) * 1000 + 36 * 3600 * 1000); // ~next day, DST-safe
  const nextYmd = epochToYmdInTz(Math.floor(next.getTime() / 1000), tz);
  return { start, endExclusive: zonedDateTimeToEpoch(nextYmd, 0, 0, tz) };
}

function epochToYmdInTz(epoch: number, tz: string): string {
  const p = partsInTz(epoch * 1000, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** "HH:mm" of an epoch (seconds) in `tz`. */
export function epochToHmInTz(epoch: number, tz: string): string {
  const p = partsInTz(epoch * 1000, tz);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** Today's date (YYYY-MM-DD) in `tz`. */
export function todayInTz(tz: string, now: Date = new Date()): string {
  return epochToYmdInTz(Math.floor(now.getTime() / 1000), tz);
}
