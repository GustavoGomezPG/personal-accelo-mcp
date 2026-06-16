import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Blitzit's Firebase Web API key — a public, project-identifying key (NOT a
 * secret: the real credential is the refresh token read from local disk). It
 * belongs to the Blitzit app and can't be rotated by us, so it's supplied via
 * env (BLITZIT_FIREBASE_API_KEY) rather than committed to the repo.
 */
function firebaseApiKey(): string {
  const key = (process.env.BLITZIT_FIREBASE_API_KEY ?? "").trim();
  if (!key) {
    throw new Error(
      "BLITZIT_FIREBASE_API_KEY is not set. Add the Blitzit Firebase web API key to the MCP server env (or .env).",
    );
  }
  return key;
}

const INDEXEDDB_DIR = join(
  homedir(),
  "Library", "Application Support", "blitzit", "IndexedDB", "app_._0.indexeddb.leveldb",
);

/** Extract the longest Firebase refresh token (starts with "AMf-") from a leveldb blob. */
export function extractRefreshToken(blob: string): string {
  const matches = blob.match(/AMf-[A-Za-z0-9_-]{60,}/g);
  if (!matches || matches.length === 0) {
    throw new Error("No Blitzit refresh token found. Open and sign into the Blitzit desktop app, then retry.");
  }
  return matches.reduce((a, b) => (b.length > a.length ? b : a));
}

function readRefreshTokenFromDisk(dir: string = INDEXEDDB_DIR): string {
  if (!existsSync(dir)) {
    throw new Error(`Blitzit app storage not found at ${dir}. Is the Blitzit desktop app installed and signed in?`);
  }
  let blob = "";
  for (const name of readdirSync(dir)) {
    try { blob += readFileSync(join(dir, name), "latin1"); } catch { /* skip locked files */ }
  }
  return extractRefreshToken(blob);
}

export async function mintIdToken(refreshToken: string): Promise<{ idToken: string; uid: string }> {
  const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${firebaseApiKey()}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });
  if (!res.ok) throw new Error(`Failed to mint Blitzit ID token (HTTP ${res.status}).`);
  const data = (await res.json()) as { access_token?: string; user_id?: string };
  if (!data.access_token || !data.user_id) throw new Error("Blitzit token response missing access_token/user_id.");
  return { idToken: data.access_token, uid: data.user_id };
}

export async function getBlitzitAuth(): Promise<{ idToken: string; uid: string }> {
  return mintIdToken(readRefreshTokenFromDisk());
}
