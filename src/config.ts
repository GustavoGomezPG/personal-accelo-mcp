export interface AcceloConfig {
  deployment: string;
  sessionCookie: string;
  endpoint: string;
  workdayStartHour: number;
  workdayTz?: string;
}

type EnvLike = Record<string, string | undefined>;

export function loadConfig(env: EnvLike = process.env): AcceloConfig {
  const deployment = (env.ACCELO_DEPLOYMENT ?? "").trim();
  const sessionCookie = (env.ACCELO_SESSION_COOKIE ?? "").trim();
  if (!deployment) throw new Error("ACCELO_DEPLOYMENT is required (e.g. 'provisionsgroup').");
  if (!sessionCookie) throw new Error("ACCELO_SESSION_COOKIE is required (the AFFINITYLIVE cookie value).");
  const startHourRaw = (env.ACCELO_WORKDAY_START_HOUR ?? "").trim();
  let workdayStartHour = 8;
  if (startHourRaw) {
    workdayStartHour = Number(startHourRaw);
    if (!Number.isInteger(workdayStartHour) || workdayStartHour < 0 || workdayStartHour > 23) {
      throw new Error("ACCELO_WORKDAY_START_HOUR: workday start hour must be an integer 0–23.");
    }
  }
  const workdayTz = (env.ACCELO_WORKDAY_TZ ?? "").trim() || undefined;
  return {
    deployment,
    sessionCookie,
    endpoint: `https://${deployment}.accelo.com/graphql`,
    workdayStartHour,
    workdayTz,
  };
}
