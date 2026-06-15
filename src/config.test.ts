import { describe, it, expect } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("builds the endpoint URL from the deployment", () => {
    const cfg = loadConfig({ ACCELO_DEPLOYMENT: "provisionsgroup", ACCELO_SESSION_COOKIE: "abc" });
    expect(cfg.deployment).toBe("provisionsgroup");
    expect(cfg.sessionCookie).toBe("abc");
    expect(cfg.endpoint).toBe("https://provisionsgroup.accelo.com/graphql");
  });

  it("throws when deployment is missing", () => {
    expect(() => loadConfig({ ACCELO_SESSION_COOKIE: "abc" })).toThrow(/ACCELO_DEPLOYMENT/);
  });

  it("throws when session cookie is missing", () => {
    expect(() => loadConfig({ ACCELO_DEPLOYMENT: "provisionsgroup" })).toThrow(/ACCELO_SESSION_COOKIE/);
  });
});
