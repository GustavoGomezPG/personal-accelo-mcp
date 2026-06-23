#!/usr/bin/env node
/**
 * Accelo session-cookie extractor.
 *
 * Opens your Accelo login page, then captures the fresh AFFINITYLIVE cookie and
 * writes it to `config/session-cookie`. The running MCP server reads that file
 * on every request, so the new cookie takes effect WITHOUT a restart.
 *
 *   npm run cookie                 # opens the login page, then prompts for the value
 *   npm run cookie -- <VALUE>      # non-interactive (pass the AFFINITYLIVE value)
 *
 * Find the value after logging in:
 *   DevTools → Application → Cookies → <your Accelo URL> → AFFINITYLIVE → copy Value.
 */
import "dotenv/config";
import { writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { exec } from "node:child_process";

const COOKIE_FILE =
  (process.env.ACCELO_SESSION_COOKIE_FILE || "").trim() ||
  fileURLToPath(new URL("../config/session-cookie", import.meta.url));

const deployment = (process.env.ACCELO_DEPLOYMENT || "").trim();
if (!deployment) {
  console.error("ACCELO_DEPLOYMENT is not set (check your .env) — cannot build the login URL.");
  process.exit(1);
}
const loginUrl = `https://${deployment}.accelo.com/`;

function openInBrowser(url) {
  const cmd =
    process.platform === "darwin" ? `open "${url}"`
    : process.platform === "win32" ? `start "" "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) console.error(`(Could not auto-open the browser: ${err.message}. Open it manually: ${url})`);
  });
}

/** Accept a bare value or a pasted "AFFINITYLIVE=xxx; ..." / quoted string. */
function clean(raw) {
  let v = (raw || "").trim();
  v = v.replace(/^.*AFFINITYLIVE=/i, "").replace(/;.*$/, "").trim();
  v = v.replace(/^["']|["']$/g, "").trim();
  return v;
}

async function main() {
  console.log(`\nAccelo session-cookie extractor — deployment "${deployment}"`);
  console.log(`Opening the login page: ${loginUrl}`);
  openInBrowser(loginUrl);
  console.log("\nAfter you finish logging in, copy the AFFINITYLIVE cookie value:");
  console.log(`  DevTools → Application → Cookies → ${loginUrl} → AFFINITYLIVE → copy its Value.\n`);

  let value = clean(process.argv[2]);
  if (!value) {
    const rl = createInterface({ input: stdin, output: stdout });
    const answer = await rl.question("Paste the AFFINITYLIVE value (or the whole cookie): ");
    rl.close();
    value = clean(answer);
  }

  if (!value || /\s/.test(value)) {
    console.error("\nNo valid cookie value provided. Nothing was written.");
    process.exit(1);
  }
  if (!/^[0-9a-f]{16,}$/i.test(value)) {
    console.warn("Warning: that doesn't look like a typical AFFINITYLIVE token — writing it anyway.");
  }

  mkdirSync(dirname(COOKIE_FILE), { recursive: true });
  writeFileSync(COOKIE_FILE, value + "\n", { mode: 0o600 });
  try { chmodSync(COOKIE_FILE, 0o600); } catch { /* best effort on platforms without POSIX modes */ }

  console.log(`\n✓ Wrote ${COOKIE_FILE}`);
  console.log("✓ No server restart needed — the next Accelo request reads this file.\n");
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
