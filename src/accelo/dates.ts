function parseYmd(date: string): { y: number; m: number; d: number } {
  const m = date.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`Invalid date: "${date}". Use YYYY-MM-DD.`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}
export function dateStartEpochUTC(date: string): number {
  const { y, m, d } = parseYmd(date);
  return Date.UTC(y, m - 1, d, 0, 0, 0) / 1000;
}
export function epochToDateStringUTC(epoch: number): string {
  return new Date(epoch * 1000).toISOString().slice(0, 10);
}
export function currentWeekRange(ref: Date = new Date()): { from: string; to: string } {
  const day = ref.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate() + mondayOffset));
  const sunday = new Date(monday.getTime() + 6 * 86400 * 1000);
  return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
}
