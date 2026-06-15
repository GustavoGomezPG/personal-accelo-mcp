import type { AcceloConfig } from "../config.js";
import { assertReadOnly } from "./readonly.js";

export type AcceloErrorCode = "SESSION_EXPIRED" | "GRAPHQL_ERROR" | "HTTP_ERROR";

export class AcceloError extends Error {
  code: AcceloErrorCode;
  constructor(code: AcceloErrorCode, message: string) {
    super(message);
    this.name = "AcceloError";
    this.code = code;
  }
}

export interface AcceloClient {
  query<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T>;
  mutate<T = unknown>(mutation: string, variables?: Record<string, unknown>): Promise<T>;
}

type FetchLike = (url: string, init: any) => Promise<Response>;

const SESSION_HELP =
  "Accelo session cookie expired or invalid. Refresh ACCELO_SESSION_COOKIE in .env with a fresh AFFINITYLIVE value from DevTools.";

export function createClient(config: AcceloConfig, fetchImpl: FetchLike = fetch): AcceloClient {
  async function send<T>(operation: string, variables: Record<string, unknown>): Promise<T> {
    const res = await fetchImpl(config.endpoint, {
      method: "POST",
      headers: {
        "Cookie": `AFFINITYLIVE=${config.sessionCookie}`,
        "X-CSRF-REQUESTED": "1",
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({ query: operation, variables }),
    });
    if (res.status === 401 || res.status === 403) throw new AcceloError("SESSION_EXPIRED", SESSION_HELP);
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) throw new AcceloError("SESSION_EXPIRED", SESSION_HELP);
    if (!res.ok) throw new AcceloError("HTTP_ERROR", `Accelo returned HTTP ${res.status}.`);
    const json = (await res.json()) as { data?: T; errors?: Array<{ message: string; path?: unknown }> };
    if (json.errors && json.errors.length > 0) {
      const first = json.errors[0];
      const where = first.path ? ` (at ${JSON.stringify(first.path)})` : "";
      throw new AcceloError("GRAPHQL_ERROR", `${first.message}${where}`);
    }
    return json.data as T;
  }
  return {
    async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
      assertReadOnly(query);
      return send<T>(query, variables);
    },
    async mutate<T>(mutation: string, variables: Record<string, unknown> = {}): Promise<T> {
      return send<T>(mutation, variables);
    },
  };
}
