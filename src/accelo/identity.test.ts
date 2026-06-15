import { describe, it, expect, vi } from "vitest";
import { getCurrentUser } from "./identity.js";
import type { AcceloClient } from "./client.js";
const fake = (data: unknown): AcceloClient => ({ query: vi.fn().mockResolvedValue(data) as any, mutate: vi.fn() as any });

describe("getCurrentUser", () => {
  it("returns staffId and timezone", async () => {
    const c = fake({ acceloConfig: { userConfig: { currentUser: { __typename: "Staff", id: "482", timezone: "America/Los_Angeles" } } } });
    expect(await getCurrentUser(c)).toEqual({ staffId: "482", timezone: "America/Los_Angeles" });
  });
  it("throws if not staff", async () => {
    const c = fake({ acceloConfig: { userConfig: { currentUser: { __typename: "Contact" } } } });
    await expect(getCurrentUser(c)).rejects.toThrow(/staff/i);
  });
});
