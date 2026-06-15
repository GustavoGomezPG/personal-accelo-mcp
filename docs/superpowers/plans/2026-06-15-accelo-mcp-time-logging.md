# Accelo MCP — Time Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four time-tracking tools to the Accelo MCP — **batch** log, list, edit, delete time entries — preserving the `Project :: Topic :: Description` nomenclature and sequencing same-day entries with no overlap (start at the workday start, default 8am, then back-to-back), while keeping the existing read-only guard intact for everything else.

**Architecture:** Add a guard-bypassing `client.mutate()` used ONLY by the new write tools (`client.query()` stays read-only). New pure/helper modules handle duration parsing, UTC dates, timezone-aware "8am" math, the current user (id + timezone), reading the user's work-logs, and subject building. `accelo_log_time` is a batch tool that computes each entry's start time. Write tools are preview-first (`confirm:false` previews without writing; delete always requires `confirm:true`).

**Tech Stack:** TypeScript (ESM, NodeNext), `@modelcontextprotocol/sdk`, `zod`, `graphql`, `vitest` with mocked client/fetch.

---

## Reference: confirmed shapes (validated live)

- `createWorkLogNote(input: createWorkLogArgs!) : Note`. `createWorkLogArgs` = `{ workLogAgainstObject: { id: ID!, type: WorkLogAgainstObjectTypes! }, workLogSubject: String!, workLogBody: RichText!, workLogLoggedTime: Seconds!, workLogIsBillable: Boolean!, workLogDate: Epoch, workLogClassId: ID }`. `type` enum lowercase: `task`,`ticket`,`project`,`milestone`,`retainer`,`sale`.
- `updateNoteLoggedTime(input:{ noteId:ID!, noteLoggedTime:Seconds! }) : Note`
- `updateNoteSubject(input:{ noteId:ID!, noteSubject:String! }) : Note`
- `deleteWorkLog(input:{ workLogId:ID! }) : Boolean` — **assumption:** `workLogId` == the note id (no separate LoggedWork id exists). Verified by the Task 13 smoke test; if wrong, adjust `time-delete.ts` only.
- Read `notes` (auto-scoped to current user): `epochs` key `NoteDate` (ops `greaterThanOrEqual`,`lessThan`); sort key `NoteDate`. `Note` = `{ id, subject, date(Epoch=start time), creator(union;Staff{id}), loggedWork{ billableTime, nonbillableTime }(Seconds), againstObject(union; Task/Ticket/Project{id,title}) }`. **Entry duration = billableTime + nonbillableTime; end = date + duration.**
- Identity + tz: `acceloConfig { userConfig { currentUser { __typename ... on Staff { id timezone } } } }`. `timezone` is IANA (live: `America/Los_Angeles`).
- Enum values pass via **variables** (JSON strings), never inline literals. `filters`/`sort` are list-typed.
- Sequencing TZ: the user's Accelo `timezone` (override via config), workday start hour configurable (default 8).

---

## Task 1: Add guard-bypassing `mutate()` to the client

**Files:** Modify `src/accelo/client.ts`; Test `src/accelo/client.mutate.test.ts`

- [ ] **Step 1: Write the failing test** — `src/accelo/client.mutate.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { createClient } from "./client.js";
import type { AcceloConfig } from "../config.js";

const config = { deployment: "demo", sessionCookie: "C", endpoint: "https://demo.accelo.com/graphql", workdayStartHour: 8 } as AcceloConfig;
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("client.mutate", () => {
  it("sends a mutation (bypassing the guard) and returns data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { createWorkLogNote: { id: "1" } } }));
    const client = createClient(config, fetchMock);
    const data = await client.mutate("mutation($i:X!){ createWorkLogNote(input:$i){ id } }", { i: { a: 1 } });
    expect(data).toEqual({ createWorkLogNote: { id: "1" } });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).query).toContain("mutation");
  });

  it("query() still rejects a mutation and never fetches", async () => {
    const fetchMock = vi.fn();
    const client = createClient(config, fetchMock);
    await expect(client.query("mutation { x }")).rejects.toThrow(/read-only/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mutate maps a GraphQL error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ errors: [{ message: "nope" }] }));
    const client = createClient(config, fetchMock);
    await expect(client.mutate("mutation { x }")).rejects.toMatchObject({ code: "GRAPHQL_ERROR" });
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/accelo/client.mutate.test.ts` → FAIL (`mutate` not a function).

- [ ] **Step 3: Refactor `src/accelo/client.ts`** — share request logic, add `mutate`:

```ts
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
```

- [ ] **Step 4: Run** `npx vitest run src/accelo/client.mutate.test.ts src/accelo/client.test.ts` → PASS (both files).
- [ ] **Step 5: Commit** `git add src/accelo/client.ts src/accelo/client.mutate.test.ts && git commit -m "feat: add guard-bypassing mutate() to the GraphQL client"`

---

## Task 2: Extend config with workday settings

**Files:** Modify `src/config.ts`; Test `src/config.workday.test.ts`

- [ ] **Step 1: Write the failing test** — `src/config.workday.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "./config.js";

const base = { ACCELO_DEPLOYMENT: "d", ACCELO_SESSION_COOKIE: "c" };

describe("loadConfig workday settings", () => {
  it("defaults workdayStartHour to 8 and workdayTz to undefined", () => {
    const c = loadConfig({ ...base });
    expect(c.workdayStartHour).toBe(8);
    expect(c.workdayTz).toBeUndefined();
  });
  it("parses ACCELO_WORKDAY_START_HOUR", () => {
    expect(loadConfig({ ...base, ACCELO_WORKDAY_START_HOUR: "9" }).workdayStartHour).toBe(9);
  });
  it("rejects an out-of-range start hour", () => {
    expect(() => loadConfig({ ...base, ACCELO_WORKDAY_START_HOUR: "30" })).toThrow(/start hour/i);
  });
  it("passes through ACCELO_WORKDAY_TZ", () => {
    expect(loadConfig({ ...base, ACCELO_WORKDAY_TZ: "America/Chicago" }).workdayTz).toBe("America/Chicago");
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/config.workday.test.ts` → FAIL.

- [ ] **Step 3: Modify `src/config.ts`** — extend the interface and loader. Add the two fields to `AcceloConfig` and parse them at the end of `loadConfig` before the return:

In the `AcceloConfig` interface add:
```ts
  workdayStartHour: number;
  workdayTz?: string;
```
In `loadConfig`, before building the returned object, add:
```ts
  const startHourRaw = (env.ACCELO_WORKDAY_START_HOUR ?? "").trim();
  let workdayStartHour = 8;
  if (startHourRaw) {
    workdayStartHour = Number(startHourRaw);
    if (!Number.isInteger(workdayStartHour) || workdayStartHour < 0 || workdayStartHour > 23) {
      throw new Error("ACCELO_WORKDAY_START_HOUR must be an integer hour 0–23.");
    }
  }
  const workdayTz = (env.ACCELO_WORKDAY_TZ ?? "").trim() || undefined;
```
and include `workdayStartHour, workdayTz` in the returned object.

- [ ] **Step 4: Run** `npx vitest run src/config.workday.test.ts src/config.test.ts` → PASS (new + original config tests).
- [ ] **Step 5: Commit** `git add src/config.ts src/config.workday.test.ts && git commit -m "feat: add workday start-hour and timezone config"`

---

## Task 3: Duration parse/format helper

**Files:** Create `src/accelo/time.ts`; Test `src/accelo/time.test.ts`

- [ ] **Step 1: Failing test** — `src/accelo/time.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { parseDuration, formatDuration } from "./time.js";

describe("parseDuration", () => {
  it("h:mm", () => expect(parseDuration("1:30")).toBe(5400));
  it("hours", () => expect(parseDuration("2h")).toBe(7200));
  it("fractional hours", () => expect(parseDuration("1.5h")).toBe(5400));
  it("minutes", () => expect(parseDuration("45m")).toBe(2700));
  it("90m", () => expect(parseDuration("90m")).toBe(5400));
  it("combined", () => expect(parseDuration("1h30m")).toBe(5400));
  it("trims", () => expect(parseDuration(" 2h ")).toBe(7200));
  it("rejects empty", () => expect(() => parseDuration("")).toThrow(/duration/i));
  it("rejects garbage", () => expect(() => parseDuration("abc")).toThrow(/duration/i));
  it("rejects zero", () => expect(() => parseDuration("0h")).toThrow(/greater than zero/i));
});
describe("formatDuration", () => {
  it("h:mm", () => { expect(formatDuration(5400)).toBe("1:30"); expect(formatDuration(2700)).toBe("0:45"); });
});
```

- [ ] **Step 2: Run** `npx vitest run src/accelo/time.test.ts` → FAIL.
- [ ] **Step 3: Implement `src/accelo/time.ts`**

```ts
export function parseDuration(input: string): number {
  const s = input.trim().toLowerCase();
  if (!s) throw new Error("Invalid duration: empty. Use e.g. '2h', '45m', or '1:30'.");
  let seconds: number | null = null;
  const colon = s.match(/^(\d+):([0-5]?\d)$/);
  if (colon) {
    seconds = Number(colon[1]) * 3600 + Number(colon[2]) * 60;
  } else {
    const hm = s.match(/^(?:(\d+(?:\.\d+)?)h)?\s*(?:(\d+(?:\.\d+)?)m)?$/);
    if (hm && (hm[1] !== undefined || hm[2] !== undefined)) {
      const hours = hm[1] !== undefined ? Number(hm[1]) : 0;
      const minutes = hm[2] !== undefined ? Number(hm[2]) : 0;
      seconds = Math.round(hours * 3600 + minutes * 60);
    }
  }
  if (seconds === null || Number.isNaN(seconds)) throw new Error(`Invalid duration: "${input}". Use e.g. '2h', '45m', '1.5h', or '1:30'.`);
  if (seconds <= 0) throw new Error("Duration must be greater than zero.");
  return seconds;
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds / 60));
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, "0")}`;
}
```

- [ ] **Step 4: Run** `npx vitest run src/accelo/time.test.ts` → PASS.
- [ ] **Step 5: Commit** `git add src/accelo/time.ts src/accelo/time.test.ts && git commit -m "feat: add duration parse/format helpers"`

---

## Task 4: UTC date helper

**Files:** Create `src/accelo/dates.ts`; Test `src/accelo/dates.test.ts`

- [ ] **Step 1: Failing test** — `src/accelo/dates.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { dateStartEpochUTC, epochToDateStringUTC, currentWeekRange } from "./dates.js";

describe("dates", () => {
  it("dateStartEpochUTC", () => expect(dateStartEpochUTC("2026-06-08")).toBe(Date.UTC(2026,5,8,0,0,0)/1000));
  it("epochToDateStringUTC", () => expect(epochToDateStringUTC(Date.UTC(2026,5,8,12,0,0)/1000)).toBe("2026-06-08"));
  it("rejects malformed", () => expect(() => dateStartEpochUTC("06/08/2026")).toThrow(/date/i));
  it("currentWeekRange Mon..Sun", () => {
    expect(currentWeekRange(new Date(Date.UTC(2026,5,10,9,0,0)))).toEqual({ from: "2026-06-08", to: "2026-06-14" });
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/accelo/dates.test.ts` → FAIL.
- [ ] **Step 3: Implement `src/accelo/dates.ts`**

```ts
function parseYmd(date: string): { y: number; m: number; d: number } {
  const m = date.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`Invalid date: "${date}". Use YYYY-MM-DD.`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}
export function dateStartEpochUTC(date: string): number {
  const { y, m, d } = parseYmd(date);
  return Date.UTC(y, m - 1, d, 0, 0, 0) / 1000;
}
export function epochToDateStringUTC(epoch: number): string {
  return new Date(epoch * 1000).toISOString().slice(0, 10);
}
export function currentWeekRange(ref: Date = new Date()): { from: string; to: string } {
  const day = ref.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate() + mondayOffset));
  const sunday = new Date(monday.getTime() + 6 * 86400 * 1000);
  return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
}
```

- [ ] **Step 4: Run** `npx vitest run src/accelo/dates.test.ts` → PASS.
- [ ] **Step 5: Commit** `git add src/accelo/dates.ts src/accelo/dates.test.ts && git commit -m "feat: add UTC date helpers"`

---

## Task 5: Timezone helper

**Files:** Create `src/accelo/tz.ts`; Test `src/accelo/tz.test.ts`

- [ ] **Step 1: Failing test** — `src/accelo/tz.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { zonedDateTimeToEpoch, dayRangeEpoch, epochToHmInTz, todayInTz } from "./tz.js";

const LA = "America/Los_Angeles";

describe("tz", () => {
  it("8am PDT (June) = 15:00 UTC", () => {
    expect(zonedDateTimeToEpoch("2026-06-08", 8, 0, LA)).toBe(Date.UTC(2026, 5, 8, 15, 0, 0) / 1000);
  });
  it("8am PST (January) = 16:00 UTC", () => {
    expect(zonedDateTimeToEpoch("2026-01-08", 8, 0, LA)).toBe(Date.UTC(2026, 0, 8, 16, 0, 0) / 1000);
  });
  it("formats an epoch as HH:mm in tz", () => {
    expect(epochToHmInTz(Date.UTC(2026, 5, 8, 15, 0, 0) / 1000, LA)).toBe("08:00");
  });
  it("dayRangeEpoch spans the local day", () => {
    const r = dayRangeEpoch("2026-06-08", LA);
    expect(r.start).toBe(Date.UTC(2026, 5, 8, 7, 0, 0) / 1000); // 00:00 PDT
    expect(r.endExclusive).toBe(Date.UTC(2026, 5, 9, 7, 0, 0) / 1000);
  });
  it("todayInTz formats YYYY-MM-DD", () => {
    expect(todayInTz(LA, new Date(Date.UTC(2026, 5, 8, 9, 0, 0)))).toBe("2026-06-08"); // 02:00 PDT same day
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/accelo/tz.test.ts` → FAIL.
- [ ] **Step 3: Implement `src/accelo/tz.ts`**

```ts
function partsInTz(epochMs: number, tz: string): Record<string, number> {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p: Record<string, number> = {};
  for (const part of dtf.formatToParts(new Date(epochMs))) if (part.type !== "literal") p[part.type] = Number(part.value);
  return p;
}

/** Offset (ms) such that local-wallclock-as-UTC === epoch + offset. */
function tzOffsetMs(epochMs: number, tz: string): number {
  const p = partsInTz(epochMs, tz);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUTC - epochMs;
}

function ymd(date: string): { y: number; m: number; d: number } {
  const m = date.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`Invalid date: "${date}". Use YYYY-MM-DD.`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** Epoch (seconds) for a wall-clock date/time in `tz`. */
export function zonedDateTimeToEpoch(date: string, hour: number, minute: number, tz: string): number {
  const { y, m, d } = ymd(date);
  const guess = Date.UTC(y, m - 1, d, hour, minute, 0);
  let epochMs = guess - tzOffsetMs(guess, tz);
  const refined = tzOffsetMs(epochMs, tz);           // second pass handles DST edges
  epochMs = guess - refined;
  return Math.floor(epochMs / 1000);
}

/** [start, endExclusive) epochs (seconds) for the local day in `tz`. */
export function dayRangeEpoch(date: string, tz: string): { start: number; endExclusive: number } {
  const start = zonedDateTimeToEpoch(date, 0, 0, tz);
  const next = new Date(zonedDateTimeToEpoch(date, 0, 0, tz) * 1000 + 36 * 3600 * 1000); // ~next day, DST-safe
  const nextYmd = epochToYmdInTz(Math.floor(next.getTime() / 1000), tz);
  return { start, endExclusive: zonedDateTimeToEpoch(nextYmd, 0, 0, tz) };
}

function epochToYmdInTz(epoch: number, tz: string): string {
  const p = partsInTz(epoch * 1000, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** "HH:mm" of an epoch (seconds) in `tz`. */
export function epochToHmInTz(epoch: number, tz: string): string {
  const p = partsInTz(epoch * 1000, tz);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** Today's date (YYYY-MM-DD) in `tz`. */
export function todayInTz(tz: string, now: Date = new Date()): string {
  return epochToYmdInTz(Math.floor(now.getTime() / 1000), tz);
}
```

- [ ] **Step 4: Run** `npx vitest run src/accelo/tz.test.ts` → PASS (5 tests).
- [ ] **Step 5: Commit** `git add src/accelo/tz.ts src/accelo/tz.test.ts && git commit -m "feat: add timezone-aware epoch helpers"`

---

## Task 6: Nomenclature + identity helpers

**Files:** Create `src/accelo/nomenclature.ts`, `src/accelo/identity.ts`; Tests alongside.

- [ ] **Step 1: Failing tests**

`src/accelo/nomenclature.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildSubject } from "./nomenclature.js";
describe("buildSubject", () => {
  it("joins with ' :: '", () => expect(buildSubject("OptimizedIT", "Website", "Fixed header")).toBe("OptimizedIT :: Website :: Fixed header"));
  it("trims parts", () => expect(buildSubject(" A ", " B ", " C ")).toBe("A :: B :: C"));
  it("rejects an empty part", () => expect(() => buildSubject("A", "", "C")).toThrow(/required/i));
});
```

`src/accelo/identity.test.ts`:
```ts
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
```

- [ ] **Step 2: Run** `npx vitest run src/accelo/nomenclature.test.ts src/accelo/identity.test.ts` → FAIL.
- [ ] **Step 3: Implement**

`src/accelo/nomenclature.ts`:
```ts
export function buildSubject(projectLabel: string, topic: string, description: string): string {
  const parts = [projectLabel, topic, description].map((p) => (p ?? "").trim());
  if (parts.some((p) => p.length === 0)) throw new Error("projectLabel, topic, and description are all required.");
  return parts.join(" :: ");
}
```

`src/accelo/identity.ts`:
```ts
import type { AcceloClient } from "./client.js";

export interface CurrentUser { staffId: string; timezone: string | null; }

const ME_QUERY = `query Me { acceloConfig { userConfig { currentUser { __typename ... on Staff { id timezone } } } } }`;

export async function getCurrentUser(client: AcceloClient): Promise<CurrentUser> {
  const data = await client.query<{ acceloConfig: { userConfig: { currentUser: { __typename: string; id?: string; timezone?: string | null } } } }>(ME_QUERY);
  const u = data.acceloConfig.userConfig.currentUser;
  if (u.__typename !== "Staff" || !u.id) throw new Error("Current user is not a staff member; cannot resolve staff id.");
  return { staffId: u.id, timezone: u.timezone ?? null };
}
```

- [ ] **Step 4: Run** `npx vitest run src/accelo/nomenclature.test.ts src/accelo/identity.test.ts` → PASS.
- [ ] **Step 5: Commit** `git add src/accelo/nomenclature.ts src/accelo/identity.ts src/accelo/nomenclature.test.ts src/accelo/identity.test.ts && git commit -m "feat: add subject-builder and current-user helpers"`

---

## Task 7: Work-log reader (`fetchMyWorkLogs`)

**Files:** Create `src/accelo/worklogs.ts`; Test `src/accelo/worklogs.test.ts`

- [ ] **Step 1: Failing test** — `src/accelo/worklogs.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { fetchMyWorkLogs, entryEnd } from "./worklogs.js";
import type { AcceloClient } from "./client.js";

const notes = { notes: { edges: [
  { node: { id: "1", subject: "A :: B :: C", date: 1000, creator: { __typename: "Staff", id: "482" }, loggedWork: { billableTime: 7200, nonbillableTime: 0 }, againstObject: { __typename: "Task", id: "9", title: "T" } } },
  { node: { id: "2", subject: "x", date: 2000, creator: { __typename: "Staff", id: "999" }, loggedWork: { billableTime: 60, nonbillableTime: 0 }, againstObject: null } },
] } };

describe("fetchMyWorkLogs", () => {
  it("filters to staffId, normalizes, and shapes the NoteDate range filter", async () => {
    const client: AcceloClient = { query: vi.fn().mockResolvedValue(notes) as any, mutate: vi.fn() as any };
    const out = await fetchMyWorkLogs(client, 500, 5000, "482");
    expect(out).toEqual([{ id: "1", startEpoch: 1000, subject: "A :: B :: C", billable: 7200, nonbillable: 0, against: { type: "Task", id: "9", title: "T" } }]);
    const [, vars] = (client.query as any).mock.calls[0];
    expect(vars.f[0].epochs).toEqual([
      { key: "NoteDate", type: "greaterThanOrEqual", value: 500 },
      { key: "NoteDate", type: "lessThan", value: 5000 },
    ]);
  });
  it("entryEnd = start + billable + nonbillable", () => {
    expect(entryEnd({ id: "1", startEpoch: 1000, subject: "", billable: 200, nonbillable: 100, against: null })).toBe(1300);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/accelo/worklogs.test.ts` → FAIL.
- [ ] **Step 3: Implement `src/accelo/worklogs.ts`**

```ts
import type { AcceloClient } from "./client.js";

export interface WorkLogEntry {
  id: string;
  startEpoch: number;
  subject: string;
  billable: number;
  nonbillable: number;
  against: { type: string; id: string | null; title: string | null } | null;
}

export function entryEnd(e: WorkLogEntry): number {
  return e.startEpoch + e.billable + e.nonbillable;
}

const QUERY = `query MyWork($f:[notesFilterAndBlockInput!]!, $s:[notesSortFieldInput!], $first:Int) {
  notes(first:$first, filters:$f, sort:$s) {
    edges { node {
      id subject date
      creator { __typename ... on Staff { id } }
      loggedWork { billableTime nonbillableTime }
      againstObject { __typename ... on Task { id title } ... on Ticket { id title } ... on Project { id title } }
    } }
  }
}`;

interface RawNote {
  id: string; subject: string | null; date: number;
  creator: { __typename: string; id?: string };
  loggedWork: { billableTime: number; nonbillableTime: number } | null;
  againstObject: { __typename: string; id?: string; title?: string } | null;
}

/** The current user's work-log notes with start in [fromEpoch, toEpochExclusive). */
export async function fetchMyWorkLogs(client: AcceloClient, fromEpoch: number, toEpochExclusive: number, staffId: string, first = 100): Promise<WorkLogEntry[]> {
  const f = [{ epochs: [
    { key: "NoteDate", type: "greaterThanOrEqual", value: fromEpoch },
    { key: "NoteDate", type: "lessThan", value: toEpochExclusive },
  ] }];
  const s = [{ key: "NoteDate", order: "ASC" }];
  const data = await client.query<{ notes: { edges: Array<{ node: RawNote }> } }>(QUERY, { f, s, first: Math.min(Math.max(first, 1), 100) });
  return data.notes.edges
    .map((e) => e.node)
    .filter((n) => n.creator.__typename === "Staff" && n.creator.id === staffId)
    .map((n) => ({
      id: n.id,
      startEpoch: n.date,
      subject: n.subject ?? "",
      billable: n.loggedWork?.billableTime ?? 0,
      nonbillable: n.loggedWork?.nonbillableTime ?? 0,
      against: n.againstObject ? { type: n.againstObject.__typename, id: n.againstObject.id ?? null, title: n.againstObject.title ?? null } : null,
    }));
}
```

- [ ] **Step 4: Run** `npx vitest run src/accelo/worklogs.test.ts` → PASS.
- [ ] **Step 5: Commit** `git add src/accelo/worklogs.ts src/accelo/worklogs.test.ts && git commit -m "feat: add current-user work-log reader"`

---

## Task 8: Shared tool output helper

**Files:** Create `src/tools/util.ts`; Test `src/tools/util.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { text } from "./util.js";
describe("text", () => {
  it("wraps a value as pretty JSON MCP content", () => {
    expect(text({ a: 1 })).toEqual({ content: [{ type: "text", text: JSON.stringify({ a: 1 }, null, 2) }] });
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/tools/util.test.ts` → FAIL.
- [ ] **Step 3: Implement `src/tools/util.ts`**

```ts
export function text(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}
```

- [ ] **Step 4: Run** `npx vitest run src/tools/util.test.ts` → PASS.
- [ ] **Step 5: Commit** `git add src/tools/util.ts src/tools/util.test.ts && git commit -m "feat: add shared tool text() helper"`

---

## Task 9: `accelo_log_time` batch tool

**Files:** Create `src/tools/time-log.ts`; Test `src/tools/time-log.test.ts`

- [ ] **Step 1: Failing test** — `src/tools/time-log.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { buildLogTimeTool } from "./time-log.js";
import type { AcceloClient } from "../accelo/client.js";
import type { AcceloConfig } from "../config.js";

const config = { deployment: "d", sessionCookie: "c", endpoint: "e", workdayStartHour: 8 } as AcceloConfig;
const LA_ME = { acceloConfig: { userConfig: { currentUser: { __typename: "Staff", id: "482", timezone: "America/Los_Angeles" } } } };
const EMPTY_NOTES = { notes: { edges: [] } };
const eightAmPdt = Date.UTC(2026, 5, 8, 15, 0, 0) / 1000; // 08:00 PDT on 2026-06-08

function client(): AcceloClient {
  return { query: vi.fn() as any, mutate: vi.fn().mockResolvedValue({ createWorkLogNote: { id: "n", subject: "s" } }) as any };
}
const entry = (o: number, d: string, t: string) => ({ objectId: o, projectLabel: "P", topic: "T", description: d, time: t });

describe("accelo_log_time (batch)", () => {
  it("is named correctly", () => {
    expect(buildLogTimeTool(client(), config).name).toBe("accelo_log_time");
  });

  it("previews an empty day starting at 08:00 then back-to-back, no writes", async () => {
    const c = client();
    (c.query as any).mockResolvedValueOnce(LA_ME).mockResolvedValueOnce(EMPTY_NOTES);
    const res = await buildLogTimeTool(c, config).handler({ date: "2026-06-08", entries: [entry(1, "A", "2h"), entry(2, "B", "1h")] });
    const p = JSON.parse(res.content[0].text);
    expect(p.preview).toBe(true);
    expect(p.tz).toBe("America/Los_Angeles");
    expect(p.entries.map((e: any) => [e.start, e.end])).toEqual([["08:00", "10:00"], ["10:00", "11:00"]]);
    expect(c.mutate).not.toHaveBeenCalled();
  });

  it("commits one mutation per entry with sequential workLogDate", async () => {
    const c = client();
    (c.query as any).mockResolvedValueOnce(LA_ME).mockResolvedValueOnce(EMPTY_NOTES);
    await buildLogTimeTool(c, config).handler({ date: "2026-06-08", entries: [entry(1, "A", "2h"), entry(2, "B", "1h")], confirm: true });
    expect((c.mutate as any).mock.calls).toHaveLength(2);
    expect((c.mutate as any).mock.calls[0][1].input.workLogDate).toBe(eightAmPdt);
    expect((c.mutate as any).mock.calls[0][1].input.workLogAgainstObject).toEqual({ id: 1, type: "task" });
    expect((c.mutate as any).mock.calls[0][1].input.workLogSubject).toBe("P :: T :: A");
    expect((c.mutate as any).mock.calls[1][1].input.workLogDate).toBe(eightAmPdt + 7200);
  });

  it("resumes after existing same-day entries (mix rule)", async () => {
    const c = client();
    // existing entry starts at 8am, 1h long -> ends 9am; new 1h entry must start at 9am
    const existing = { notes: { edges: [{ node: { id: "9", subject: "x", date: eightAmPdt, creator: { __typename: "Staff", id: "482" }, loggedWork: { billableTime: 3600, nonbillableTime: 0 }, againstObject: null } }] } };
    (c.query as any).mockResolvedValueOnce(LA_ME).mockResolvedValueOnce(existing);
    await buildLogTimeTool(c, config).handler({ date: "2026-06-08", entries: [entry(2, "B", "1h")], confirm: true });
    expect((c.mutate as any).mock.calls[0][1].input.workLogDate).toBe(eightAmPdt + 3600);
  });

  it("aborts the whole batch on an invalid duration, before any read or write", async () => {
    const c = client();
    await expect(buildLogTimeTool(c, config).handler({ date: "2026-06-08", entries: [entry(1, "A", "2h"), entry(2, "B", "bad")], confirm: true })).rejects.toThrow(/duration/i);
    expect(c.query).not.toHaveBeenCalled();
    expect(c.mutate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/tools/time-log.test.ts` → FAIL.
- [ ] **Step 3: Implement `src/tools/time-log.ts`**

```ts
import { z } from "zod";
import type { AcceloClient } from "../accelo/client.js";
import type { AcceloConfig } from "../config.js";
import type { ToolDescriptor } from "./factory.js";
import { text } from "./util.js";
import { parseDuration, formatDuration } from "../accelo/time.js";
import { buildSubject } from "../accelo/nomenclature.js";
import { getCurrentUser } from "../accelo/identity.js";
import { fetchMyWorkLogs, entryEnd } from "../accelo/worklogs.js";
import { zonedDateTimeToEpoch, dayRangeEpoch, epochToHmInTz, todayInTz } from "../accelo/tz.js";

const OBJECT_TYPES = ["task", "ticket", "project", "milestone", "retainer", "sale"] as const;

const LOG_MUTATION = `mutation Log($input: createWorkLogArgs!) { createWorkLogNote(input: $input) { id subject } }`;

const entrySchema = z.object({
  objectId: z.number().int().describe("Object id to log against (usually a task id)."),
  objectType: z.enum(OBJECT_TYPES).optional().describe("Object type (default 'task')."),
  projectLabel: z.string().describe("Nomenclature segment 1, e.g. 'OptimizedIT'."),
  topic: z.string().describe("Nomenclature segment 2, e.g. 'Website'."),
  description: z.string().describe("Nomenclature segment 3 — what you did."),
  time: z.string().describe("Duration: '2h', '45m', '1.5h', or '1:30'."),
  billable: z.boolean().optional().describe("Billable? (default true)."),
  workTypeId: z.number().int().optional().describe("Optional work type / class id."),
});

export function buildLogTimeTool(client: AcceloClient, config: AcceloConfig): ToolDescriptor {
  return {
    name: "accelo_log_time",
    description:
      "Log one or more time entries for a single day, sequenced with no overlap (starts at the workday start, default 8am, then back-to-back; resumes after entries already logged that day). Uses the 'Project :: Topic :: Description' nomenclature. Preview by default; pass confirm:true to log.",
    inputSchema: {
      date: z.string().optional().describe("Day for all entries, YYYY-MM-DD (default today in your timezone)."),
      entries: z.array(entrySchema).min(1).describe("Ordered list of entries; start times follow this order."),
      confirm: z.boolean().optional().describe("Set true to actually log; otherwise returns the schedule preview."),
    },
    handler: async (args) => {
      // 1. Validate + prepare everything first (abort the whole batch before any network call).
      const prepared = (args.entries as Array<z.infer<typeof entrySchema>>).map((e) => ({
        objectId: e.objectId,
        objectType: e.objectType ?? "task",
        subject: buildSubject(e.projectLabel, e.topic, e.description),
        body: e.description,
        seconds: parseDuration(e.time),
        billable: e.billable ?? true,
        workTypeId: e.workTypeId,
      }));

      // 2. Resolve user + timezone.
      const user = await getCurrentUser(client);
      const tz = config.workdayTz ?? user.timezone ?? "UTC";
      const date = args.date ?? todayInTz(tz);

      // 3. Compute the starting cursor (8am, or after existing same-day entries).
      const workdayStart = zonedDateTimeToEpoch(date, config.workdayStartHour, 0, tz);
      const { start, endExclusive } = dayRangeEpoch(date, tz);
      const existing = await fetchMyWorkLogs(client, start, endExclusive, user.staffId);
      const latestEnd = existing.reduce((max, e) => Math.max(max, entryEnd(e)), 0);
      const resumedAfterExisting = existing.length > 0 && latestEnd > workdayStart;
      let cursor = Math.max(workdayStart, latestEnd);

      // 4. Assign sequential start times.
      const scheduled = prepared.map((p) => {
        const startEpoch = cursor;
        cursor += p.seconds;
        return { ...p, startEpoch, endEpoch: cursor };
      });

      const schedule = scheduled.map((s) => ({
        subject: s.subject,
        against: { id: s.objectId, type: s.objectType },
        start: epochToHmInTz(s.startEpoch, tz),
        end: epochToHmInTz(s.endEpoch, tz),
        loggedTime: formatDuration(s.seconds),
        billable: s.billable,
      }));

      // 5. Preview or commit.
      if (!args.confirm) {
        return text({ preview: true, date, tz, resumedAfterExisting, willLog: "Set confirm:true to log these entries.", entries: schedule });
      }

      const created: Array<{ id: string; subject: string; start: string; loggedTime: string }> = [];
      for (const s of scheduled) {
        const input: Record<string, unknown> = {
          workLogAgainstObject: { id: s.objectId, type: s.objectType },
          workLogSubject: s.subject,
          workLogBody: s.body,
          workLogLoggedTime: s.seconds,
          workLogIsBillable: s.billable,
          workLogDate: s.startEpoch,
        };
        if (s.workTypeId !== undefined) input.workLogClassId = s.workTypeId;
        const data = await client.mutate<{ createWorkLogNote: { id: string; subject: string } }>(LOG_MUTATION, { input });
        created.push({ id: data.createWorkLogNote.id, subject: data.createWorkLogNote.subject, start: epochToHmInTz(s.startEpoch, tz), loggedTime: formatDuration(s.seconds) });
      }
      return text({ logged: true, date, tz, resumedAfterExisting, created });
    },
  };
}
```

- [ ] **Step 4: Run** `npx vitest run src/tools/time-log.test.ts` → PASS (5 tests).
- [ ] **Step 5: Commit** `git add src/tools/time-log.ts src/tools/time-log.test.ts && git commit -m "feat: add accelo_log_time batch tool with non-overlap sequencing"`

---

## Task 10: `accelo_list_my_time` tool

**Files:** Create `src/tools/time-list.ts`; Test `src/tools/time-list.test.ts`

- [ ] **Step 1: Failing test** — `src/tools/time-list.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { buildListTimeTool } from "./time-list.js";
import type { AcceloClient } from "../accelo/client.js";

const ME = { acceloConfig: { userConfig: { currentUser: { __typename: "Staff", id: "482", timezone: "America/Los_Angeles" } } } };
const NOTES = { notes: { edges: [
  { node: { id: "1", subject: "A :: B :: C", date: Date.UTC(2026,5,8,15,0,0)/1000, creator: { __typename: "Staff", id: "482" }, loggedWork: { billableTime: 7200, nonbillableTime: 0 }, againstObject: { __typename: "Task", id: "9", title: "T" } } },
] } };

describe("accelo_list_my_time", () => {
  it("is named correctly", () => {
    const c: AcceloClient = { query: vi.fn() as any, mutate: vi.fn() as any };
    expect(buildListTimeTool(c).name).toBe("accelo_list_my_time");
  });
  it("lists entries for an explicit range and sums billable", async () => {
    const c: AcceloClient = { query: vi.fn() as any, mutate: vi.fn() as any };
    (c.query as any).mockResolvedValueOnce(ME).mockResolvedValueOnce(NOTES);
    const res = await buildListTimeTool(c).handler({ from: "2026-06-08", to: "2026-06-14" });
    const p = JSON.parse(res.content[0].text);
    expect(p.from).toBe("2026-06-08");
    expect(p.to).toBe("2026-06-14");
    expect(p.items).toHaveLength(1);
    expect(p.items[0]).toMatchObject({ id: "1", subject: "A :: B :: C", billable: "2:00", against: { type: "Task", id: "9", title: "T" } });
    expect(p.totalBillable).toBe("2:00");
    const notesVars = (c.query as any).mock.calls[1][1];
    expect(notesVars.f[0].epochs).toEqual([
      { key: "NoteDate", type: "greaterThanOrEqual", value: Date.UTC(2026,5,8,0,0,0)/1000 },
      { key: "NoteDate", type: "lessThan", value: Date.UTC(2026,5,15,0,0,0)/1000 },
    ]);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/tools/time-list.test.ts` → FAIL.
- [ ] **Step 3: Implement `src/tools/time-list.ts`**

```ts
import { z } from "zod";
import type { AcceloClient } from "../accelo/client.js";
import type { ToolDescriptor } from "./factory.js";
import { text } from "./util.js";
import { dateStartEpochUTC, epochToDateStringUTC, currentWeekRange } from "../accelo/dates.js";
import { formatDuration } from "../accelo/time.js";
import { getCurrentUser } from "../accelo/identity.js";
import { fetchMyWorkLogs } from "../accelo/worklogs.js";

export function buildListTimeTool(client: AcceloClient): ToolDescriptor {
  return {
    name: "accelo_list_my_time",
    description: "List your own time entries for a date range (default current week, Mon–Sun). Read-only.",
    inputSchema: {
      from: z.string().optional().describe("Start date YYYY-MM-DD (default Monday of current week)."),
      to: z.string().optional().describe("End date YYYY-MM-DD inclusive (default Sunday of current week)."),
      first: z.number().int().positive().optional().describe("Max entries (default 50, max 100)."),
    },
    handler: async (args) => {
      const week = currentWeekRange();
      const from = args.from ?? week.from;
      const to = args.to ?? week.to;
      const first = Math.min(Math.max(args.first ?? 50, 1), 100);

      const user = await getCurrentUser(client);
      const fromEpoch = dateStartEpochUTC(from);
      const toExclusive = dateStartEpochUTC(to) + 86400;
      const entries = await fetchMyWorkLogs(client, fromEpoch, toExclusive, user.staffId, first);

      const items = entries.map((e) => ({
        id: e.id,
        date: epochToDateStringUTC(e.startEpoch),
        subject: e.subject,
        billable: formatDuration(e.billable),
        nonbillable: formatDuration(e.nonbillable),
        against: e.against,
      }));
      const totalBillable = formatDuration(entries.reduce((s, e) => s + e.billable, 0));
      return text({ from, to, count: items.length, totalBillable, items });
    },
  };
}
```

- [ ] **Step 4: Run** `npx vitest run src/tools/time-list.test.ts` → PASS.
- [ ] **Step 5: Commit** `git add src/tools/time-list.ts src/tools/time-list.test.ts && git commit -m "feat: add accelo_list_my_time tool"`

---

## Task 11: `accelo_edit_time` tool

**Files:** Create `src/tools/time-edit.ts`; Test `src/tools/time-edit.test.ts`

- [ ] **Step 1: Failing test** — `src/tools/time-edit.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { buildEditTimeTool } from "./time-edit.js";
import type { AcceloClient } from "../accelo/client.js";
const client = (): AcceloClient => ({ query: vi.fn() as any, mutate: vi.fn().mockResolvedValue({}) as any });

describe("accelo_edit_time", () => {
  it("named correctly", () => expect(buildEditTimeTool(client()).name).toBe("accelo_edit_time"));
  it("previews without writing", async () => {
    const c = client();
    const res = await buildEditTimeTool(c).handler({ noteId: 5, time: "1:30" });
    expect(JSON.parse(res.content[0].text).preview).toBe(true);
    expect(c.mutate).not.toHaveBeenCalled();
  });
  it("updates logged time when confirmed", async () => {
    const c = client();
    await buildEditTimeTool(c).handler({ noteId: 5, time: "1:30", confirm: true });
    const [m, v] = (c.mutate as any).mock.calls[0];
    expect(m).toContain("updateNoteLoggedTime");
    expect(v.input).toEqual({ noteId: 5, noteLoggedTime: 5400 });
  });
  it("updates subject from parts when confirmed", async () => {
    const c = client();
    await buildEditTimeTool(c).handler({ noteId: 5, projectLabel: "A", topic: "B", description: "C", confirm: true });
    const subj = (c.mutate as any).mock.calls.find((x: any[]) => x[0].includes("updateNoteSubject"));
    expect(subj[1].input).toEqual({ noteId: 5, noteSubject: "A :: B :: C" });
  });
  it("rejects with no change", async () => {
    const c = client();
    await expect(buildEditTimeTool(c).handler({ noteId: 5, confirm: true })).rejects.toThrow(/no change/i);
    expect(c.mutate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/tools/time-edit.test.ts` → FAIL.
- [ ] **Step 3: Implement `src/tools/time-edit.ts`**

```ts
import { z } from "zod";
import type { AcceloClient } from "../accelo/client.js";
import type { ToolDescriptor } from "./factory.js";
import { text } from "./util.js";
import { parseDuration, formatDuration } from "../accelo/time.js";
import { buildSubject } from "../accelo/nomenclature.js";

const TIME_MUTATION = `mutation EditTime($input: updateNoteLoggedTimeArgs!) { updateNoteLoggedTime(input: $input) { id subject } }`;
const SUBJECT_MUTATION = `mutation EditSubject($input: updateNoteSubjectArgs!) { updateNoteSubject(input: $input) { id subject } }`;

export function buildEditTimeTool(client: AcceloClient): ToolDescriptor {
  return {
    name: "accelo_edit_time",
    description:
      "Edit a time entry's logged time and/or subject. Pass `time` to change duration; pass projectLabel+topic+description (or a verbatim `subject`) to change the title. Preview by default; confirm:true applies.",
    inputSchema: {
      noteId: z.number().int().describe("Note id of the entry."),
      time: z.string().optional().describe("New duration: '2h', '45m', '1:30'."),
      projectLabel: z.string().optional().describe("New nomenclature segment 1."),
      topic: z.string().optional().describe("New nomenclature segment 2."),
      description: z.string().optional().describe("New nomenclature segment 3."),
      subject: z.string().optional().describe("Verbatim new subject (alternative to the three parts)."),
      confirm: z.boolean().optional().describe("Set true to apply."),
    },
    handler: async (args) => {
      const changes: { loggedTime?: string; seconds?: number; subject?: string } = {};
      let newSeconds: number | undefined;
      let newSubject: string | undefined;

      if (args.time !== undefined) { newSeconds = parseDuration(args.time); changes.loggedTime = formatDuration(newSeconds); changes.seconds = newSeconds; }
      if (args.subject !== undefined) newSubject = args.subject.trim();
      else if (args.projectLabel !== undefined || args.topic !== undefined || args.description !== undefined)
        newSubject = buildSubject(args.projectLabel ?? "", args.topic ?? "", args.description ?? "");
      if (newSubject !== undefined) changes.subject = newSubject;

      if (newSeconds === undefined && newSubject === undefined) throw new Error("No change specified: provide `time` and/or a new subject.");
      if (!args.confirm) return text({ preview: true, noteId: args.noteId, changes, willApply: "Set confirm:true to apply." });

      if (newSeconds !== undefined) await client.mutate(TIME_MUTATION, { input: { noteId: args.noteId, noteLoggedTime: newSeconds } });
      if (newSubject !== undefined) await client.mutate(SUBJECT_MUTATION, { input: { noteId: args.noteId, noteSubject: newSubject } });
      return text({ updated: true, noteId: args.noteId, changes });
    },
  };
}
```

- [ ] **Step 4: Run** `npx vitest run src/tools/time-edit.test.ts` → PASS.
- [ ] **Step 5: Commit** `git add src/tools/time-edit.ts src/tools/time-edit.test.ts && git commit -m "feat: add accelo_edit_time tool"`

---

## Task 12: `accelo_delete_time` tool + registration

**Files:** Create `src/tools/time-delete.ts` (+test); Modify `src/tools/register.ts`, `src/tools/register.test.ts`, `src/index.ts`

- [ ] **Step 1: Failing test for delete** — `src/tools/time-delete.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { buildDeleteTimeTool } from "./time-delete.js";
import type { AcceloClient } from "../accelo/client.js";
const client = (): AcceloClient => ({ query: vi.fn() as any, mutate: vi.fn().mockResolvedValue({ deleteWorkLog: true }) as any });

describe("accelo_delete_time", () => {
  it("named correctly", () => expect(buildDeleteTimeTool(client()).name).toBe("accelo_delete_time"));
  it("refuses without confirm:true", async () => {
    const c = client();
    const res = await buildDeleteTimeTool(c).handler({ noteId: 5 });
    const p = JSON.parse(res.content[0].text);
    expect(p.deleted).toBe(false);
    expect(p.note).toMatch(/confirm:true/);
    expect(c.mutate).not.toHaveBeenCalled();
  });
  it("deletes with confirm:true", async () => {
    const c = client();
    await buildDeleteTimeTool(c).handler({ noteId: 5, confirm: true });
    const [m, v] = (c.mutate as any).mock.calls[0];
    expect(m).toContain("deleteWorkLog");
    expect(v.input).toEqual({ workLogId: 5 });
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/tools/time-delete.test.ts` → FAIL.
- [ ] **Step 3: Implement `src/tools/time-delete.ts`**

```ts
import { z } from "zod";
import type { AcceloClient } from "../accelo/client.js";
import type { ToolDescriptor } from "./factory.js";
import { text } from "./util.js";

const DELETE_MUTATION = `mutation Delete($input: deleteWorkLogArgs!) { deleteWorkLog(input: $input) }`;

export function buildDeleteTimeTool(client: AcceloClient): ToolDescriptor {
  return {
    name: "accelo_delete_time",
    description: "Delete a time entry by its note id. DESTRUCTIVE: requires confirm:true; otherwise only reports what would be deleted.",
    inputSchema: {
      noteId: z.number().int().describe("Note id of the entry to delete (used as workLogId)."),
      confirm: z.boolean().optional().describe("Must be true to actually delete."),
    },
    handler: async (args) => {
      if (args.confirm !== true) return text({ deleted: false, noteId: args.noteId, note: "Destructive action. Re-call with confirm:true to delete this entry." });
      await client.mutate<{ deleteWorkLog: boolean }>(DELETE_MUTATION, { input: { workLogId: args.noteId } });
      return text({ deleted: true, noteId: args.noteId });
    },
  };
}
```

- [ ] **Step 4: Run** `npx vitest run src/tools/time-delete.test.ts` → PASS.

- [ ] **Step 5: Update `src/tools/register.test.ts`** (collectTools now takes config and returns 16 tools)

```ts
import { describe, it, expect, vi } from "vitest";
import { collectTools } from "./register.js";
import type { AcceloClient } from "../accelo/client.js";
import type { AcceloConfig } from "../config.js";

const client: AcceloClient = { query: vi.fn() as any, mutate: vi.fn() as any };
const config = { deployment: "d", sessionCookie: "c", endpoint: "e", workdayStartHour: 8 } as AcceloConfig;

describe("collectTools", () => {
  it("includes read tools plus the four time-tracking tools (16 total)", () => {
    const names = collectTools(client, config).map((t) => t.name).sort();
    for (const n of ["accelo_search_companies", "accelo_graphql", "accelo_log_time", "accelo_list_my_time", "accelo_edit_time", "accelo_delete_time"])
      expect(names).toContain(n);
    expect(names.length).toBe(16);
  });
  it("has no duplicate names", () => {
    const names = collectTools(client, config).map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
```

- [ ] **Step 6: Run** `npx vitest run src/tools/register.test.ts` → FAIL (signature/count).

- [ ] **Step 7: Update `src/tools/register.ts`**

```ts
import type { AcceloClient } from "../accelo/client.js";
import type { AcceloConfig } from "../config.js";
import { ENTITIES } from "../accelo/entities.js";
import { buildEntityTools, type ToolDescriptor } from "./factory.js";
import { buildExtraTools } from "./extras.js";
import { buildLogTimeTool } from "./time-log.js";
import { buildListTimeTool } from "./time-list.js";
import { buildEditTimeTool } from "./time-edit.js";
import { buildDeleteTimeTool } from "./time-delete.js";

export function collectTools(client: AcceloClient, config: AcceloConfig): ToolDescriptor[] {
  const entityTools = ENTITIES.flatMap((entity) => buildEntityTools(entity, client));
  const timeTools = [
    buildLogTimeTool(client, config),
    buildListTimeTool(client),
    buildEditTimeTool(client),
    buildDeleteTimeTool(client),
  ];
  return [...entityTools, ...buildExtraTools(client), ...timeTools];
}
```

- [ ] **Step 8: Update `src/index.ts`** — pass `config` to `collectTools`. Change the one line `for (const tool of collectTools(client)) {` to `for (const tool of collectTools(client, config)) {`.

- [ ] **Step 9: Build + full suite** `npm run build && npm test` → `tsc` clean; all tests PASS.

- [ ] **Step 10: Commit** `git add src/tools/time-delete.ts src/tools/time-delete.test.ts src/tools/register.ts src/tools/register.test.ts src/index.ts && git commit -m "feat: add accelo_delete_time and register time-tracking tools"`

---

## Task 13: Docs + live verification

**Files:** Modify `README.md`

- [ ] **Step 1: Replace the "## Tools" section of `README.md`**

````markdown
## Tools

Read tools (read-only). For each of **companies, contacts, projects, tickets, tasks**:
- `accelo_search_<entities>` and `accelo_get_<entity>`.
Schema escape hatches (read-only): `accelo_graphql`, `accelo_introspect`.

Time tracking (read/write):
- `accelo_log_time` — log one or more entries for a day using the `Project :: Topic :: Description`
  nomenclature. Entries are sequenced with no overlap: they start at the workday start
  (`ACCELO_WORKDAY_START_HOUR`, default 8) in your Accelo timezone (override with
  `ACCELO_WORKDAY_TZ`), back-to-back, resuming after anything already logged that day. Preview by
  default; pass `confirm:true` to log.
- `accelo_list_my_time` — list your entries for a date range (default current week).
- `accelo_edit_time` — change an entry's logged time and/or subject (preview/confirm).
- `accelo_delete_time` — delete an entry (requires `confirm:true`).

**Write safety:** only the four time-tracking tools can mutate, via a dedicated client path.
`accelo_graphql` and all read tools stay strictly read-only. Write tools preview by default and
require `confirm:true` to apply.
````

- [ ] **Step 2: Build + full suite** `npm run build && npm test` → clean + green.

- [ ] **Step 3: Manual live smoke test (real cookie)** — batch-log two entries on an empty test day, verify sequencing, then list/edit/delete:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"accelo_log_time","arguments":{"date":"2026-06-20","entries":[{"objectId":36927,"projectLabel":"MCP-TEST","topic":"Test","description":"first","time":"2h"},{"objectId":36927,"projectLabel":"MCP-TEST","topic":"Test","description":"second","time":"1h"}],"confirm":true}}}' \
  | node dist/index.js
```
Expected: two created notes; the first at 08:00 and the second at 10:00 (your tz). Then call
`accelo_list_my_time` (`from`/`to` = 2026-06-20) to confirm both appear, `accelo_edit_time` to
change one to `30m`, and `accelo_delete_time` (`confirm:true`) on both. Confirm in the Accelo UI
that the test day is clean. If `deleteWorkLog` rejects the note id, the workLogId differs — adjust
`time-delete.ts` and note the finding.

- [ ] **Step 4: Commit** `git add README.md && git commit -m "docs: document time-tracking tools and sequencing"`

---

## Notes for the implementer

- **ESM/NodeNext:** local imports use `.js` extensions.
- **Enums via variables only.** Never inline enum literals.
- **`AcceloClient` has `query` + `mutate`.** Every fake client in tests must include both.
- **`collectTools(client, config)`** now takes config (for the workday settings); `index.ts` passes it.
- **Validate-then-network in `log_time`:** all entry validation (durations, subjects) happens before any `query`/`mutate`, so a bad batch aborts cleanly (a test asserts `query` is never called).
- **Preview invariant:** write tools must not call `mutate` when `confirm` is falsy.
- **No new mutation paths** outside the four time tools.
