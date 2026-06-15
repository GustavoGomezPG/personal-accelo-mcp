export function parseDuration(input: string): number {
  const s = input.trim().toLowerCase();
  if (!s) throw new Error("Invalid duration: empty. Use e.g. '2h', '45m', or '1:30'.");
  let seconds: number | null = null;
  const colon = s.match(/^(\d+):([0-5]?\d)$/);
  if (colon) {
    seconds = Number(colon[1]) * 3600 + Number(colon[2]) * 60;
  } else {
    const hm = s.match(/^(?:(\d+(?:\.\d+)?)h)?\s*(?:(\d+(?:\.\d+)?)m)?$/);
    if (hm && (hm[1] !== undefined || hm[2] !== undefined)) {
      const hours = hm[1] !== undefined ? Number(hm[1]) : 0;
      const minutes = hm[2] !== undefined ? Number(hm[2]) : 0;
      seconds = Math.round(hours * 3600 + minutes * 60);
    }
  }
  if (seconds === null || Number.isNaN(seconds)) throw new Error(`Invalid duration: "${input}". Use e.g. '2h', '45m', '1.5h', or '1:30'.`);
  if (seconds <= 0) throw new Error("Duration must be greater than zero.");
  return seconds;
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds / 60));
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, "0")}`;
}
