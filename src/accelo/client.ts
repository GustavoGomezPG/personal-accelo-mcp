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
}

type FetchLike = (url: string, init: any) => Promise<Response>;

const SESSION_HELP =
  "Accelo session cookie expired or invalid. Refresh ACCELO_SESSION_COOKIE in .env with a fresh AFFINITYLIVE value from DevTools.";

export function createClient(config: AcceloConfig, fetchImpl: FetchLike = fetch): AcceloClient {
  return {
    async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
      assertReadOnly(query);

      const res = await fetchImpl(config.endpoint, {
        method: "POST",
        headers: {
          "Cookie": `AFFINITYLIVE=${config.sessionCookie}`,
          "X-CSRF-REQUESTED": "1",
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({ query, variables }),
      });

      if (res.status === 401 || res.status === 403) {
        throw new AcceloError("SESSION_EXPIRED", SESSION_HELP);
      }
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        // A login redirect returns HTML rather than JSON.
        throw new AcceloError("SESSION_EXPIRED", SESSION_HELP);
      }
      if (!res.ok) {
        throw new AcceloError("HTTP_ERROR", `Accelo returned HTTP ${res.status}.`);
      }

      const json = (await res.json()) as { data?: T; errors?: Array<{ message: string; path?: unknown }> };
      if (json.errors && json.errors.length > 0) {
        const first = json.errors[0];
        const where = first.path ? ` (at ${JSON.stringify(first.path)})` : "";
        throw new AcceloError("GRAPHQL_ERROR", `${first.message}${where}`);
      }
      return json.data as T;
    },
  };
}
