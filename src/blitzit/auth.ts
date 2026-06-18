import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
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

const BLITZIT_DIR = join(homedir(), "Library", "Application Support", "blitzit");

/**
 * Blitzit's leveldb stores that may hold the Firebase refresh token, in priority
 * order. Newer Blitzit/Firebase builds persist auth in Local Storage; older ones
 * used IndexedDB. We scan both so the token is found regardless of where the app
 * keeps it.
 */
const TOKEN_DIRS = [
  join(BLITZIT_DIR, "Local Storage", "leveldb"),
  join(BLITZIT_DIR, "IndexedDB", "app_._0.indexeddb.leveldb"),
];

const REFRESH_TOKEN_RE = /AMf-[A-Za-z0-9_-]{60,}/g;

/** Extract the longest Firebase refresh token (starts with "AMf-") from a leveldb blob. */
export function extractRefreshToken(blob: string): string {
  const matches = blob.match(REFRESH_TOKEN_RE);
  if (!matches || matches.length === 0) {
    throw new Error("No Blitzit refresh token found. Open and sign into the Blitzit desktop app, then retry.");
  }
  return matches.reduce((a, b) => (b.length > a.length ? b : a));
}

function readRefreshTokenFromDisk(dirs: string[] = TOKEN_DIRS): string {
  // Gather every leveldb file across the known stores, newest first, so the
  // current token (in the active .log / most recent .ldb) wins over stale ones
  // left behind by previous sign-ins or a since-relocated store.
  const files: { path: string; mtime: number }[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      try { files.push({ path, mtime: statSync(path).mtimeMs }); } catch { /* skip */ }
    }
  }
  if (files.length === 0) {
    throw new Error(
      `Blitzit app storage not found under ${BLITZIT_DIR}. Is the Blitzit desktop app installed and signed in?`,
    );
  }
  files.sort((a, b) => b.mtime - a.mtime);
  for (const { path } of files) {
    let blob = "";
    try { blob = readFileSync(path, "latin1"); } catch { continue; /* locked */ }
    const matches = blob.match(REFRESH_TOKEN_RE);
    if (matches && matches.length) {
      return matches.reduce((a, b) => (b.length > a.length ? b : a));
    }
  }
  throw new Error("No Blitzit refresh token found. Open and sign into the Blitzit desktop app, then retry.");
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
