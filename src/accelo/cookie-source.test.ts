import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSessionCookie, cookieFilePath } from "./cookie-source.js";
import type { AcceloConfig } from "../config.js";

const config = { deployment: "d", sessionCookie: "ENVVAL", endpoint: "e", workdayStartHour: 8 } as AcceloConfig;

function tempCookie(contents: string): { file: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "accelo-cs-"));
  const file = join(dir, "session-cookie");
  writeFileSync(file, contents);
  return { file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("resolveSessionCookie", () => {
  it("falls back to config.sessionCookie when the file is absent", () => {
    expect(resolveSessionCookie(config, { ACCELO_SESSION_COOKIE_FILE: "/no/such/accelo/file" })).toBe("ENVVAL");
  });

  it("prefers the file value and trims surrounding whitespace", () => {
    const { file, cleanup } = tempCookie("  FILEVAL\n");
    try {
      expect(resolveSessionCookie(config, { ACCELO_SESSION_COOKIE_FILE: file })).toBe("FILEVAL");
    } finally {
      cleanup();
    }
  });

  it("falls back when the file is empty or whitespace-only", () => {
    const { file, cleanup } = tempCookie("   \n");
    try {
      expect(resolveSessionCookie(config, { ACCELO_SESSION_COOKIE_FILE: file })).toBe("ENVVAL");
    } finally {
      cleanup();
    }
  });
});

describe("cookieFilePath", () => {
  it("honors the ACCELO_SESSION_COOKIE_FILE override", () => {
    expect(cookieFilePath({ ACCELO_SESSION_COOKIE_FILE: "/custom/path" })).toBe("/custom/path");
  });

  it("defaults to <project-root>/config/session-cookie", () => {
    expect(cookieFilePath({}).endsWith("/config/session-cookie")).toBe(true);
  });
});
