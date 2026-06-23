import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AcceloConfig } from "../config.js";

type EnvLike = Record<string, string | undefined>;

/**
 * Path to the live session-cookie file.
 *
 * The file is what makes a refreshed AFFINITYLIVE value take effect WITHOUT
 * restarting the MCP server: it is read on every request. Override the location
 * with ACCELO_SESSION_COOKIE_FILE; otherwise it defaults to
 * `<project-root>/config/session-cookie`, resolved relative to this module so
 * it is independent of the process working directory.
 */
export function cookieFilePath(env: EnvLike = process.env): string {
  const explicit = (env.ACCELO_SESSION_COOKIE_FILE ?? "").trim();
  if (explicit) return explicit;
  return fileURLToPath(new URL("../../config/session-cookie", import.meta.url));
}

/**
 * Resolve the AFFINITYLIVE cookie value to send on a request.
 *
 * Prefers the session-cookie file (so a refresh needs no restart); falls back
 * to the value baked in at startup (`config.sessionCookie`, from the
 * ACCELO_SESSION_COOKIE env var) when the file is absent, empty, or unreadable.
 */
export function resolveSessionCookie(config: AcceloConfig, env: EnvLike = process.env): string {
  try {
    const fromFile = readFileSync(cookieFilePath(env), "utf8").trim();
    if (fromFile) return fromFile;
  } catch {
    // no file (or unreadable) -> fall back to the startup value
  }
  return config.sessionCookie;
}
