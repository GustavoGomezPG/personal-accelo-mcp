export interface AcceloConfig {
  deployment: string;
  sessionCookie: string;
  endpoint: string;
}

type EnvLike = Record<string, string | undefined>;

export function loadConfig(env: EnvLike = process.env): AcceloConfig {
  const deployment = (env.ACCELO_DEPLOYMENT ?? "").trim();
  const sessionCookie = (env.ACCELO_SESSION_COOKIE ?? "").trim();
  if (!deployment) throw new Error("ACCELO_DEPLOYMENT is required (e.g. 'provisionsgroup').");
  if (!sessionCookie) throw new Error("ACCELO_SESSION_COOKIE is required (the AFFINITYLIVE cookie value).");
  return {
    deployment,
    sessionCookie,
    endpoint: `https://${deployment}.accelo.com/graphql`,
  };
}
