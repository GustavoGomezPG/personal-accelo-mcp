# Accelo MCP — Time Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four time-tracking tools to the Accelo MCP — log, list, edit, delete time entries — preserving the `Project :: Topic :: Description` nomenclature, while keeping the existing read-only guard intact for everything else.

**Architecture:** Add a guard-bypassing `client.mutate()` used ONLY by the four new write tools (`client.query()` stays read-only, so `accelo_graphql` cannot mutate). New pure helpers handle duration parsing, date math, the current staff id, and subject building. Each write tool is preview-first (`confirm:false` previews without writing; `confirm:true` executes); delete always requires `confirm:true`.

**Tech Stack:** TypeScript (ESM, NodeNext), `@modelcontextprotocol/sdk`, `zod`, `graphql`, `vitest` with mocked client/fetch. (Same stack as the base MCP.)

---

## Reference: confirmed mutation/read shapes (validated live)

- `createWorkLogNote(input: createWorkLogArgs!) : Note`. `createWorkLogArgs` = `{ workLogAgainstObject: { id: ID!, type: WorkLogAgainstObjectTypes! }, workLogSubject: String!, workLogBody: RichText!, workLogLoggedTime: Seconds!, workLogIsBillable: Boolean!, workLogDate: Epoch, workLogClassId: ID }`. `type` enum values are lowercase: `task`, `ticket`, `project`, `milestone`, `retainer`, `sale`, …
- `updateNoteLoggedTime(input: { noteId: ID!, noteLoggedTime: Seconds! }) : Note`
- `updateNoteSubject(input: { noteId: ID!, noteSubject: String! }) : Note`
- `deleteWorkLog(input: { workLogId: ID! }) : Boolean` — **assumption:** `workLogId` is the note id (the work-log-note id). `LoggedWork` has no separate id field, so the note id is the handle. Verified by the create→delete manual smoke test in Task 10. If that test shows otherwise, adjust `time-delete.ts` only.
- Read: `notes` connection is auto-scoped to the current user. Filter `epochs` key `NoteDate` (ops `greaterThanOrEqual`, `lessThan`); sort key `NoteDate`. `Note` = `{ id, subject, date(Epoch), creator(union;Staff), loggedWork{ billableTime, nonbillableTime }(Seconds), againstObject(union; Task/Ticket/Project…) }`.
- Identity: `acceloConfig { userConfig { currentUser { ... on Staff { id } } } }`.
- Enum values must be passed via **variables** (JSON strings), never inline literals. `filters`/`sort` are list-typed.
- **Dates are handled in UTC.** Logged entries are stamped at **12:00 UTC** on the given day (noon avoids day-boundary drift across US timezones). Listing uses `[from 00:00 UTC, (to+1 day) 00:00 UTC)`.

---

## Task 1: Add guard-bypassing `mutate()` to the client

**Files:**
- Modify: `src/accelo/client.ts`
- Test: `src/accelo/client.mutate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { createClient } from "./client.js";
import type { AcceloConfig } from "../config.js";

const config: AcceloConfig = { deployment: "demo", sessionCookie: "C", endpoint: "https://demo.accelo.com/graphql" };
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("client.mutate", () => {
  it("sends a mutation (bypassing the read-only guard) and returns data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { createWorkLogNote: { id: "1" } } }));
    const client = createClient(config, fetchMock);
    const data = await client.mutate("mutation($i:X!){ createWorkLogNote(input:$i){ id } }", { i: { a: 1 } });
    expect(data).toEqual({ createWorkLogNote: { id: "1" } });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["X-CSRF-REQUESTED"]).toBe("1");
    expect(JSON.parse(init.body).query).toContain("mutation");
  });

  it("query() still rejects a mutation and never calls fetch", async () => {
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

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/accelo/client.mutate.test.ts`
Expected: FAIL — `client.mutate is not a function`.

- [ ] **Step 3: Refactor `client.ts` to share send logic and add `mutate`**

Replace the body of `createClient` so the request/response handling lives in one private `send` function used by both `query` (with guard) and `mutate` (without). The full file becomes:

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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/accelo/client.mutate.test.ts src/accelo/client.test.ts`
Expected: PASS (both the new mutate tests and the original client tests — the refactor preserves `query` behavior).

- [ ] **Step 5: Commit**

```bash
git add src/accelo/client.ts src/accelo/client.mutate.test.ts
git commit -m "feat: add guard-bypassing mutate() to the GraphQL client"
```

---

## Task 2: Duration parsing/formatting helper

**Files:**
- Create: `src/accelo/time.ts`
- Test: `src/accelo/time.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { parseDuration, formatDuration } from "./time.js";

describe("parseDuration", () => {
  it("parses h:mm", () => { expect(parseDuration("1:30")).toBe(5400); });
  it("parses hours with h", () => { expect(parseDuration("2h")).toBe(7200); });
  it("parses fractional hours", () => { expect(parseDuration("1.5h")).toBe(5400); });
  it("parses minutes", () => { expect(parseDuration("45m")).toBe(2700); });
  it("parses 90m", () => { expect(parseDuration("90m")).toBe(5400); });
  it("parses combined h and m", () => { expect(parseDuration("1h30m")).toBe(5400); });
  it("trims whitespace", () => { expect(parseDuration(" 2h ")).toBe(7200); });
  it("rejects empty", () => { expect(() => parseDuration("")).toThrow(/duration/i); });
  it("rejects garbage", () => { expect(() => parseDuration("abc")).toThrow(/duration/i); });
  it("rejects zero", () => { expect(() => parseDuration("0h")).toThrow(/greater than zero/i); });
});

describe("formatDuration", () => {
  it("formats to h:mm", () => {
    expect(formatDuration(5400)).toBe("1:30");
    expect(formatDuration(7200)).toBe("2:00");
    expect(formatDuration(2700)).toBe("0:45");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/accelo/time.test.ts`
Expected: FAIL — cannot find module `./time.js`.

- [ ] **Step 3: Implement `src/accelo/time.ts`**

```ts
/** Parse a human duration into seconds. Accepts "1:30", "2h", "1.5h", "45m", "90m", "1h30m". */
export function parseDuration(input: string): number {
  const s = input.trim().toLowerCase();
  if (!s) throw new Error("Invalid duration: empty string. Use e.g. '2h', '45m', or '1:30'.");

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

  if (seconds === null || Number.isNaN(seconds)) {
    throw new Error(`Invalid duration: "${input}". Use e.g. '2h', '45m', '1.5h', or '1:30'.`);
  }
  if (seconds <= 0) throw new Error("Duration must be greater than zero.");
  return seconds;
}

/** Format seconds as "h:mm". */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds / 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}:${m.toString().padStart(2, "0")}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/accelo/time.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add src/accelo/time.ts src/accelo/time.test.ts
git commit -m "feat: add duration parse/format helpers"
```

---

## Task 3: Date helper

**Files:**
- Create: `src/accelo/dates.ts`
- Test: `src/accelo/dates.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { dateToEpochNoonUTC, dateStartEpochUTC, epochToDateStringUTC, currentWeekRange } from "./dates.js";

describe("dates", () => {
  it("dateToEpochNoonUTC stamps noon UTC", () => {
    expect(dateToEpochNoonUTC("2026-06-08")).toBe(Date.UTC(2026, 5, 8, 12, 0, 0) / 1000);
  });
  it("dateStartEpochUTC stamps midnight UTC", () => {
    expect(dateStartEpochUTC("2026-06-08")).toBe(Date.UTC(2026, 5, 8, 0, 0, 0) / 1000);
  });
  it("epochToDateStringUTC formats YYYY-MM-DD", () => {
    expect(epochToDateStringUTC(Date.UTC(2026, 5, 8, 12, 0, 0) / 1000)).toBe("2026-06-08");
  });
  it("rejects a malformed date", () => {
    expect(() => dateToEpochNoonUTC("06/08/2026")).toThrow(/date/i);
  });
  it("currentWeekRange returns Mon..Sun for a midweek reference", () => {
    // 2026-06-10 is a Wednesday
    const r = currentWeekRange(new Date(Date.UTC(2026, 5, 10, 9, 0, 0)));
    expect(r).toEqual({ from: "2026-06-08", to: "2026-06-14" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/accelo/dates.test.ts`
Expected: FAIL — cannot find module `./dates.js`.

- [ ] **Step 3: Implement `src/accelo/dates.ts`**

```ts
function parseYmd(date: string): { y: number; m: number; d: number } {
  const m = date.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`Invalid date: "${date}". Use YYYY-MM-DD.`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** Epoch (seconds) at 12:00 UTC on the given day — used when logging, to avoid timezone day-drift. */
export function dateToEpochNoonUTC(date: string): number {
  const { y, m, d } = parseYmd(date);
  return Date.UTC(y, m - 1, d, 12, 0, 0) / 1000;
}

/** Epoch (seconds) at 00:00 UTC on the given day — used for range boundaries. */
export function dateStartEpochUTC(date: string): number {
  const { y, m, d } = parseYmd(date);
  return Date.UTC(y, m - 1, d, 0, 0, 0) / 1000;
}

/** Format an epoch (seconds) as YYYY-MM-DD in UTC. */
export function epochToDateStringUTC(epoch: number): string {
  return new Date(epoch * 1000).toISOString().slice(0, 10);
}

/** Monday..Sunday (YYYY-MM-DD) of the week containing `ref` (UTC). */
export function currentWeekRange(ref: Date = new Date()): { from: string; to: string } {
  const day = ref.getUTCDay(); // 0=Sun..6=Sat
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate() + mondayOffset));
  const sunday = new Date(monday.getTime() + 6 * 86400 * 1000);
  return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/accelo/dates.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/accelo/dates.ts src/accelo/dates.test.ts
git commit -m "feat: add UTC date helpers for time logging"
```

---

## Task 4: Nomenclature + identity helpers

**Files:**
- Create: `src/accelo/nomenclature.ts`
- Create: `src/accelo/identity.ts`
- Test: `src/accelo/nomenclature.test.ts`
- Test: `src/accelo/identity.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/accelo/nomenclature.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildSubject } from "./nomenclature.js";

describe("buildSubject", () => {
  it("joins parts with ' :: '", () => {
    expect(buildSubject("OptimizedIT", "Website", "Fixed the header")).toBe("OptimizedIT :: Website :: Fixed the header");
  });
  it("trims each part", () => {
    expect(buildSubject(" A ", " B ", " C ")).toBe("A :: B :: C");
  });
  it("rejects an empty part", () => {
    expect(() => buildSubject("A", "", "C")).toThrow(/required/i);
  });
});
```

`src/accelo/identity.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { getCurrentStaffId } from "./identity.js";
import type { AcceloClient } from "./client.js";

function fakeClient(data: unknown): AcceloClient {
  return { query: vi.fn().mockResolvedValue(data) as any, mutate: vi.fn() as any };
}

describe("getCurrentStaffId", () => {
  it("returns the current staff id", async () => {
    const client = fakeClient({ acceloConfig: { userConfig: { currentUser: { __typename: "Staff", id: "482" } } } });
    expect(await getCurrentStaffId(client)).toBe("482");
  });
  it("throws if current user is not staff", async () => {
    const client = fakeClient({ acceloConfig: { userConfig: { currentUser: { __typename: "Contact" } } } });
    await expect(getCurrentStaffId(client)).rejects.toThrow(/staff/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/accelo/nomenclature.test.ts src/accelo/identity.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement both modules**

`src/accelo/nomenclature.ts`:
```ts
/** Build a time-entry subject in the "Project :: Topic :: Description" nomenclature. */
export function buildSubject(projectLabel: string, topic: string, description: string): string {
  const parts = [projectLabel, topic, description].map((p) => (p ?? "").trim());
  if (parts.some((p) => p.length === 0)) {
    throw new Error("projectLabel, topic, and description are all required to build the subject.");
  }
  return parts.join(" :: ");
}
```

`src/accelo/identity.ts`:
```ts
import type { AcceloClient } from "./client.js";

const ME_QUERY = `query Me { acceloConfig { userConfig { currentUser { __typename ... on Staff { id } } } } }`;

/** Resolve the current session user's staff id. */
export async function getCurrentStaffId(client: AcceloClient): Promise<string> {
  const data = await client.query<{ acceloConfig: { userConfig: { currentUser: { __typename: string; id?: string } } } }>(ME_QUERY);
  const u = data.acceloConfig.userConfig.currentUser;
  if (u.__typename !== "Staff" || !u.id) throw new Error("Current user is not a staff member; cannot resolve staff id.");
  return u.id;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/accelo/nomenclature.test.ts src/accelo/identity.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/accelo/nomenclature.ts src/accelo/identity.ts src/accelo/nomenclature.test.ts src/accelo/identity.test.ts
git commit -m "feat: add subject-builder and current-staff-id helpers"
```

---

## Task 5: Shared tool output helper

**Files:**
- Create: `src/tools/util.ts`
- Test: `src/tools/util.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { text } from "./util.js";

describe("text", () => {
  it("wraps a value as pretty JSON MCP text content", () => {
    expect(text({ a: 1 })).toEqual({ content: [{ type: "text", text: JSON.stringify({ a: 1 }, null, 2) }] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tools/util.test.ts`
Expected: FAIL — cannot find module `./util.js`.

- [ ] **Step 3: Implement `src/tools/util.ts`**

```ts
export function text(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tools/util.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/tools/util.ts src/tools/util.test.ts
git commit -m "feat: add shared tool text() output helper"
```

---

## Task 6: `accelo_log_time` tool

**Files:**
- Create: `src/tools/time-log.ts`
- Test: `src/tools/time-log.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { buildLogTimeTool } from "./time-log.js";
import type { AcceloClient } from "../accelo/client.js";

function fakeClient(mutateData: unknown): AcceloClient {
  return { query: vi.fn() as any, mutate: vi.fn().mockResolvedValue(mutateData) as any };
}

const baseArgs = { objectId: 36927, projectLabel: "OptimizedIT", topic: "Website", description: "Fixed header", time: "2h" };

describe("accelo_log_time", () => {
  it("has the expected name", () => {
    expect(buildLogTimeTool(fakeClient({})).name).toBe("accelo_log_time");
  });

  it("previews without writing when confirm is omitted", async () => {
    const client = fakeClient({});
    const tool = buildLogTimeTool(client);
    const res = await tool.handler({ ...baseArgs });
    const p = JSON.parse(res.content[0].text);
    expect(p.preview).toBe(true);
    expect(p.subject).toBe("OptimizedIT :: Website :: Fixed header");
    expect(p.loggedTime).toBe("2:00");
    expect(p.seconds).toBe(7200);
    expect(p.billable).toBe(true);
    expect(client.mutate).not.toHaveBeenCalled();
  });

  it("logs when confirm is true with correct variables", async () => {
    const client = fakeClient({ createWorkLogNote: { id: "999", subject: "OptimizedIT :: Website :: Fixed header" } });
    const tool = buildLogTimeTool(client);
    const res = await tool.handler({ ...baseArgs, billable: false, date: "2026-06-08", confirm: true });

    const p = JSON.parse(res.content[0].text);
    expect(p.created.id).toBe("999");

    const [mutation, vars] = (client.mutate as any).mock.calls[0];
    expect(mutation).toContain("createWorkLogNote");
    expect(vars.input.workLogAgainstObject).toEqual({ id: 36927, type: "task" });
    expect(vars.input.workLogSubject).toBe("OptimizedIT :: Website :: Fixed header");
    expect(vars.input.workLogBody).toBe("Fixed header");
    expect(vars.input.workLogLoggedTime).toBe(7200);
    expect(vars.input.workLogIsBillable).toBe(false);
    expect(vars.input.workLogDate).toBe(Date.UTC(2026, 5, 8, 12, 0, 0) / 1000);
  });

  it("rejects an invalid duration before any write", async () => {
    const client = fakeClient({});
    const tool = buildLogTimeTool(client);
    await expect(tool.handler({ ...baseArgs, time: "abc", confirm: true })).rejects.toThrow(/duration/i);
    expect(client.mutate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tools/time-log.test.ts`
Expected: FAIL — cannot find module `./time-log.js`.

- [ ] **Step 3: Implement `src/tools/time-log.ts`**

```ts
import { z } from "zod";
import type { AcceloClient } from "../accelo/client.js";
import type { ToolDescriptor } from "./factory.js";
import { text } from "./util.js";
import { parseDuration, formatDuration } from "../accelo/time.js";
import { dateToEpochNoonUTC } from "../accelo/dates.js";
import { buildSubject } from "../accelo/nomenclature.js";

const OBJECT_TYPES = ["task", "ticket", "project", "milestone", "retainer", "sale"] as const;

const LOG_MUTATION = `mutation Log($input: createWorkLogArgs!) {
  createWorkLogNote(input: $input) { id subject }
}`;

export function buildLogTimeTool(client: AcceloClient): ToolDescriptor {
  return {
    name: "accelo_log_time",
    description:
      "Log a time entry (work-log note) against a task/ticket, using the 'Project :: Topic :: Description' nomenclature. Preview by default; pass confirm:true to actually log. Read/write.",
    inputSchema: {
      objectId: z.number().int().describe("The id of the object to log against (usually a task id)."),
      objectType: z.enum(OBJECT_TYPES).optional().describe("Object type to log against (default 'task')."),
      projectLabel: z.string().describe("First nomenclature segment, e.g. 'OptimizedIT' (required)."),
      topic: z.string().describe("Second nomenclature segment, e.g. 'Website' (required)."),
      description: z.string().describe("Third nomenclature segment — what you did (required)."),
      time: z.string().describe("Duration: '2h', '45m', '1.5h', or '1:30'."),
      billable: z.boolean().optional().describe("Billable? (default true)."),
      date: z.string().optional().describe("Entry date YYYY-MM-DD (default today, UTC)."),
      workTypeId: z.number().int().optional().describe("Optional work type / class id."),
      confirm: z.boolean().optional().describe("Set true to actually log; otherwise returns a preview."),
    },
    handler: async (args) => {
      const subject = buildSubject(args.projectLabel, args.topic, args.description);
      const seconds = parseDuration(args.time);
      const objectType = args.objectType ?? "task";
      const billable = args.billable ?? true;
      const dateStr = args.date ?? new Date().toISOString().slice(0, 10);
      const workLogDate = dateToEpochNoonUTC(dateStr);

      if (!args.confirm) {
        return text({
          preview: true,
          willLog: "Set confirm:true to log this entry.",
          subject,
          against: { id: args.objectId, type: objectType },
          loggedTime: formatDuration(seconds),
          seconds,
          billable,
          date: dateStr,
        });
      }

      const input: Record<string, unknown> = {
        workLogAgainstObject: { id: args.objectId, type: objectType },
        workLogSubject: subject,
        workLogBody: args.description,
        workLogLoggedTime: seconds,
        workLogIsBillable: billable,
        workLogDate,
      };
      if (args.workTypeId !== undefined) input.workLogClassId = args.workTypeId;

      const data = await client.mutate<{ createWorkLogNote: { id: string; subject: string } }>(LOG_MUTATION, { input });
      return text({ created: data.createWorkLogNote, loggedTime: formatDuration(seconds), date: dateStr });
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tools/time-log.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/time-log.ts src/tools/time-log.test.ts
git commit -m "feat: add accelo_log_time tool"
```

---

## Task 7: `accelo_list_my_time` tool

**Files:**
- Create: `src/tools/time-list.ts`
- Test: `src/tools/time-list.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { buildListTimeTool } from "./time-list.js";
import type { AcceloClient } from "../accelo/client.js";

function fakeClient(queryData: unknown): AcceloClient {
  return { query: vi.fn().mockResolvedValue(queryData) as any, mutate: vi.fn() as any };
}

const notesData = {
  notes: {
    totalCount: 2,
    edges: [
      { node: { id: "1", subject: "A :: B :: C", date: Date.UTC(2026,5,8,12,0,0)/1000,
        creator: { __typename: "Staff", id: "482" }, loggedWork: { billableTime: 7200, nonbillableTime: 0 },
        againstObject: { __typename: "Task", id: "36927", title: "MoM" } } },
      { node: { id: "2", subject: "D :: E :: F", date: Date.UTC(2026,5,9,12,0,0)/1000,
        creator: { __typename: "Staff", id: "999" }, loggedWork: { billableTime: 1800, nonbillableTime: 0 },
        againstObject: { __typename: "Task", id: "1", title: "X" } } },
    ],
  },
};

describe("accelo_list_my_time", () => {
  it("is named correctly", () => {
    expect(buildListTimeTool(fakeClient({})).name).toBe("accelo_list_my_time");
  });

  it("queries the given range and maps entries (defensively filtering to current staff)", async () => {
    const client = fakeClient(notesData);
    // identity call returns staff 482, then notes query returns notesData
    (client.query as any)
      .mockResolvedValueOnce({ acceloConfig: { userConfig: { currentUser: { __typename: "Staff", id: "482" } } } })
      .mockResolvedValueOnce(notesData);

    const tool = buildListTimeTool(client);
    const res = await tool.handler({ from: "2026-06-08", to: "2026-06-14" });
    const p = JSON.parse(res.content[0].text);

    expect(p.from).toBe("2026-06-08");
    expect(p.to).toBe("2026-06-14");
    expect(p.items).toHaveLength(1); // staff 999 filtered out
    expect(p.items[0]).toMatchObject({ id: "1", subject: "A :: B :: C", date: "2026-06-08", billable: "2:00", against: { type: "Task", id: "36927", title: "MoM" } });
    expect(p.totalBillable).toBe("2:00");

    const notesCall = (client.query as any).mock.calls[1];
    expect(notesCall[1].f[0].epochs).toEqual([
      { key: "NoteDate", type: "greaterThanOrEqual", value: Date.UTC(2026,5,8,0,0,0)/1000 },
      { key: "NoteDate", type: "lessThan", value: Date.UTC(2026,5,15,0,0,0)/1000 },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tools/time-list.test.ts`
Expected: FAIL — cannot find module `./time-list.js`.

- [ ] **Step 3: Implement `src/tools/time-list.ts`**

```ts
import { z } from "zod";
import type { AcceloClient } from "../accelo/client.js";
import type { ToolDescriptor } from "./factory.js";
import { text } from "./util.js";
import { dateStartEpochUTC, epochToDateStringUTC, currentWeekRange } from "../accelo/dates.js";
import { formatDuration } from "../accelo/time.js";
import { getCurrentStaffId } from "../accelo/identity.js";

const NOTES_QUERY = `query MyTime($f:[notesFilterAndBlockInput!]!, $s:[notesSortFieldInput!], $first:Int) {
  notes(first:$first, filters:$f, sort:$s) {
    totalCount
    edges { node {
      id subject date
      creator { __typename ... on Staff { id } }
      loggedWork { billableTime nonbillableTime }
      againstObject { __typename ... on Task { id title } ... on Ticket { id title } ... on Project { id title } }
    } }
  }
}`;

interface NoteNode {
  id: string; subject: string | null; date: number;
  creator: { __typename: string; id?: string };
  loggedWork: { billableTime: number; nonbillableTime: number } | null;
  againstObject: { __typename: string; id?: string; title?: string } | null;
}

export function buildListTimeTool(client: AcceloClient): ToolDescriptor {
  return {
    name: "accelo_list_my_time",
    description: "List your own time entries (work-log notes) for a date range (default current week, Mon–Sun). Read-only.",
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

      const staffId = await getCurrentStaffId(client);

      const f = [{
        epochs: [
          { key: "NoteDate", type: "greaterThanOrEqual", value: dateStartEpochUTC(from) },
          { key: "NoteDate", type: "lessThan", value: dateStartEpochUTC(to) + 86400 },
        ],
      }];
      const s = [{ key: "NoteDate", order: "ASC" }];

      const data = await client.query<{ notes: { totalCount: number; edges: Array<{ node: NoteNode }> } }>(
        NOTES_QUERY, { f, s, first },
      );

      const items = data.notes.edges
        .map((e) => e.node)
        .filter((n) => n.creator.__typename === "Staff" && n.creator.id === staffId)
        .map((n) => ({
          id: n.id,
          date: epochToDateStringUTC(n.date),
          subject: n.subject ?? "",
          billable: formatDuration(n.loggedWork?.billableTime ?? 0),
          nonbillable: formatDuration(n.loggedWork?.nonbillableTime ?? 0),
          against: n.againstObject
            ? { type: n.againstObject.__typename, id: n.againstObject.id ?? null, title: n.againstObject.title ?? null }
            : null,
        }));

      const totalBillableSeconds = data.notes.edges
        .map((e) => e.node)
        .filter((n) => n.creator.id === staffId)
        .reduce((sum, n) => sum + (n.loggedWork?.billableTime ?? 0), 0);

      return text({ from, to, count: items.length, totalBillable: formatDuration(totalBillableSeconds), items });
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tools/time-list.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/time-list.ts src/tools/time-list.test.ts
git commit -m "feat: add accelo_list_my_time tool"
```

---

## Task 8: `accelo_edit_time` tool

**Files:**
- Create: `src/tools/time-edit.ts`
- Test: `src/tools/time-edit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { buildEditTimeTool } from "./time-edit.js";
import type { AcceloClient } from "../accelo/client.js";

function fakeClient(): AcceloClient {
  return { query: vi.fn() as any, mutate: vi.fn().mockResolvedValue({}) as any };
}

describe("accelo_edit_time", () => {
  it("is named correctly", () => {
    expect(buildEditTimeTool(fakeClient()).name).toBe("accelo_edit_time");
  });

  it("previews without writing when confirm omitted", async () => {
    const client = fakeClient();
    const res = await buildEditTimeTool(client).handler({ noteId: 5, time: "1:30" });
    const p = JSON.parse(res.content[0].text);
    expect(p.preview).toBe(true);
    expect(p.changes.loggedTime).toBe("1:30");
    expect(client.mutate).not.toHaveBeenCalled();
  });

  it("updates logged time when confirmed", async () => {
    const client = fakeClient();
    await buildEditTimeTool(client).handler({ noteId: 5, time: "1:30", confirm: true });
    const [mutation, vars] = (client.mutate as any).mock.calls[0];
    expect(mutation).toContain("updateNoteLoggedTime");
    expect(vars.input).toEqual({ noteId: 5, noteLoggedTime: 5400 });
  });

  it("updates subject from nomenclature parts when confirmed", async () => {
    const client = fakeClient();
    await buildEditTimeTool(client).handler({ noteId: 5, projectLabel: "A", topic: "B", description: "C", confirm: true });
    const calls = (client.mutate as any).mock.calls;
    const subjCall = calls.find((c: any[]) => c[0].includes("updateNoteSubject"));
    expect(subjCall[1].input).toEqual({ noteId: 5, noteSubject: "A :: B :: C" });
  });

  it("rejects when no change is specified", async () => {
    const client = fakeClient();
    await expect(buildEditTimeTool(client).handler({ noteId: 5, confirm: true })).rejects.toThrow(/no change/i);
    expect(client.mutate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tools/time-edit.test.ts`
Expected: FAIL — cannot find module `./time-edit.js`.

- [ ] **Step 3: Implement `src/tools/time-edit.ts`**

```ts
import { z } from "zod";
import type { AcceloClient } from "../accelo/client.js";
import type { ToolDescriptor } from "./factory.js";
import { text } from "./util.js";
import { parseDuration, formatDuration } from "../accelo/time.js";
import { buildSubject } from "../accelo/nomenclature.js";

const TIME_MUTATION = `mutation EditTime($input: updateNoteLoggedTimeArgs!) {
  updateNoteLoggedTime(input: $input) { id subject }
}`;
const SUBJECT_MUTATION = `mutation EditSubject($input: updateNoteSubjectArgs!) {
  updateNoteSubject(input: $input) { id subject }
}`;

export function buildEditTimeTool(client: AcceloClient): ToolDescriptor {
  return {
    name: "accelo_edit_time",
    description:
      "Edit an existing time entry's logged time and/or subject. Pass `time` to change duration; pass projectLabel+topic+description (or a verbatim `subject`) to change the title. Preview by default; confirm:true to apply. Read/write.",
    inputSchema: {
      noteId: z.number().int().describe("The note id of the time entry to edit."),
      time: z.string().optional().describe("New duration: '2h', '45m', '1:30'."),
      projectLabel: z.string().optional().describe("New nomenclature segment 1 (with topic+description)."),
      topic: z.string().optional().describe("New nomenclature segment 2."),
      description: z.string().optional().describe("New nomenclature segment 3."),
      subject: z.string().optional().describe("Verbatim new subject (alternative to the three parts)."),
      confirm: z.boolean().optional().describe("Set true to apply; otherwise returns a preview."),
    },
    handler: async (args) => {
      const changes: { loggedTime?: string; seconds?: number; subject?: string } = {};
      let newSeconds: number | undefined;
      let newSubject: string | undefined;

      if (args.time !== undefined) {
        newSeconds = parseDuration(args.time);
        changes.loggedTime = formatDuration(newSeconds);
        changes.seconds = newSeconds;
      }
      if (args.subject !== undefined) {
        newSubject = args.subject.trim();
      } else if (args.projectLabel !== undefined || args.topic !== undefined || args.description !== undefined) {
        newSubject = buildSubject(args.projectLabel ?? "", args.topic ?? "", args.description ?? "");
      }
      if (newSubject !== undefined) changes.subject = newSubject;

      if (newSeconds === undefined && newSubject === undefined) {
        throw new Error("No change specified: provide `time` and/or a new subject (parts or `subject`).");
      }

      if (!args.confirm) {
        return text({ preview: true, noteId: args.noteId, changes, willApply: "Set confirm:true to apply." });
      }

      if (newSeconds !== undefined) {
        await client.mutate(TIME_MUTATION, { input: { noteId: args.noteId, noteLoggedTime: newSeconds } });
      }
      if (newSubject !== undefined) {
        await client.mutate(SUBJECT_MUTATION, { input: { noteId: args.noteId, noteSubject: newSubject } });
      }
      return text({ updated: true, noteId: args.noteId, changes });
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tools/time-edit.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/time-edit.ts src/tools/time-edit.test.ts
git commit -m "feat: add accelo_edit_time tool"
```

---

## Task 9: `accelo_delete_time` tool + registration

**Files:**
- Create: `src/tools/time-delete.ts`
- Test: `src/tools/time-delete.test.ts`
- Modify: `src/tools/register.ts`
- Modify: `src/tools/register.test.ts`

- [ ] **Step 1: Write the failing test for delete**

```ts
import { describe, it, expect, vi } from "vitest";
import { buildDeleteTimeTool } from "./time-delete.js";
import type { AcceloClient } from "../accelo/client.js";

function fakeClient(): AcceloClient {
  return { query: vi.fn() as any, mutate: vi.fn().mockResolvedValue({ deleteWorkLog: true }) as any };
}

describe("accelo_delete_time", () => {
  it("is named correctly", () => {
    expect(buildDeleteTimeTool(fakeClient()).name).toBe("accelo_delete_time");
  });

  it("refuses and does not write without confirm:true", async () => {
    const client = fakeClient();
    const res = await buildDeleteTimeTool(client).handler({ noteId: 5 });
    const p = JSON.parse(res.content[0].text);
    expect(p.deleted).toBe(false);
    expect(p.note).toMatch(/confirm:true/);
    expect(client.mutate).not.toHaveBeenCalled();
  });

  it("deletes when confirm:true", async () => {
    const client = fakeClient();
    await buildDeleteTimeTool(client).handler({ noteId: 5, confirm: true });
    const [mutation, vars] = (client.mutate as any).mock.calls[0];
    expect(mutation).toContain("deleteWorkLog");
    expect(vars.input).toEqual({ workLogId: 5 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tools/time-delete.test.ts`
Expected: FAIL — cannot find module `./time-delete.js`.

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
    description:
      "Delete a time entry (work-log note) by its note id. DESTRUCTIVE: requires confirm:true; without it, it only reports what would be deleted. Read/write.",
    inputSchema: {
      noteId: z.number().int().describe("The note id of the time entry to delete (used as workLogId)."),
      confirm: z.boolean().optional().describe("Must be true to actually delete."),
    },
    handler: async (args) => {
      if (args.confirm !== true) {
        return text({ deleted: false, noteId: args.noteId, note: "Destructive action. Re-call with confirm:true to delete this entry." });
      }
      await client.mutate<{ deleteWorkLog: boolean }>(DELETE_MUTATION, { input: { workLogId: args.noteId } });
      return text({ deleted: true, noteId: args.noteId });
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tools/time-delete.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Update `src/tools/register.test.ts`**

Replace the count assertions and add the new tool names. The two tests become:

```ts
import { describe, it, expect, vi } from "vitest";
import { collectTools } from "./register.js";
import type { AcceloClient } from "../accelo/client.js";

const client: AcceloClient = { query: vi.fn() as any, mutate: vi.fn() as any };

describe("collectTools", () => {
  it("includes the read tools plus the four time-tracking tools", () => {
    const names = collectTools(client).map((t) => t.name).sort();
    expect(names).toContain("accelo_search_companies");
    expect(names).toContain("accelo_graphql");
    expect(names).toContain("accelo_log_time");
    expect(names).toContain("accelo_list_my_time");
    expect(names).toContain("accelo_edit_time");
    expect(names).toContain("accelo_delete_time");
    // 5 entities * 2 + 2 extras + 4 time tools = 16
    expect(names.length).toBe(16);
  });

  it("has no duplicate tool names", () => {
    const names = collectTools(client).map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/tools/register.test.ts`
Expected: FAIL — `collectTools` still returns 12 tools / new names missing.

- [ ] **Step 7: Update `src/tools/register.ts`**

```ts
import type { AcceloClient } from "../accelo/client.js";
import { ENTITIES } from "../accelo/entities.js";
import { buildEntityTools, type ToolDescriptor } from "./factory.js";
import { buildExtraTools } from "./extras.js";
import { buildLogTimeTool } from "./time-log.js";
import { buildListTimeTool } from "./time-list.js";
import { buildEditTimeTool } from "./time-edit.js";
import { buildDeleteTimeTool } from "./time-delete.js";

export function collectTools(client: AcceloClient): ToolDescriptor[] {
  const entityTools = ENTITIES.flatMap((entity) => buildEntityTools(entity, client));
  const timeTools = [
    buildLogTimeTool(client),
    buildListTimeTool(client),
    buildEditTimeTool(client),
    buildDeleteTimeTool(client),
  ];
  return [...entityTools, ...buildExtraTools(client), ...timeTools];
}
```

- [ ] **Step 8: Run tests + build to verify all pass**

Run: `npx vitest run src/tools/register.test.ts src/tools/time-delete.test.ts && npm run build && npm test`
Expected: register tests PASS (16 tools), delete tests PASS, `tsc` clean, full suite PASS.

- [ ] **Step 9: Commit**

```bash
git add src/tools/time-delete.ts src/tools/time-delete.test.ts src/tools/register.ts src/tools/register.test.ts
git commit -m "feat: add accelo_delete_time tool and register time-tracking tools"
```

---

## Task 10: Docs + live verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the Tools section of `README.md`**

Replace the existing "## Tools" section with:

````markdown
## Tools

Read tools (read-only). For each of **companies, contacts, projects, tickets, tasks**:
- `accelo_search_<entities>` — free-text search + id filters + sort + pagination.
- `accelo_get_<entity>` — fetch one by numeric id.

Schema escape hatches (read-only):
- `accelo_graphql` — run an arbitrary read-only GraphQL query.
- `accelo_introspect` — explore the schema.

Time tracking (read/write):
- `accelo_log_time` — log a time entry against a task/ticket using the
  `Project :: Topic :: Description` nomenclature. Preview by default; pass
  `confirm:true` to log.
- `accelo_list_my_time` — list your own entries for a date range (default current week).
- `accelo_edit_time` — change an entry's logged time and/or subject (preview/confirm).
- `accelo_delete_time` — delete an entry (requires `confirm:true`).

**Write safety:** only the four time-tracking tools can mutate, and they go through a
dedicated client path. `accelo_graphql` and all read tools remain strictly read-only
(mutations are rejected). Write tools preview by default and require `confirm:true` to apply.
````

- [ ] **Step 2: Build + full test suite**

Run: `npm run build && npm test`
Expected: `tsc` clean; all tests PASS.

- [ ] **Step 3: Manual live smoke test (real cookie required)**

With a valid `.env`, run the round-trip via stdio (log → list → edit → delete a throwaway entry). Use a real task id you own (e.g. 36927). This also verifies the `deleteWorkLog` workLogId==noteId assumption.

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"accelo_log_time","arguments":{"objectId":36927,"projectLabel":"MCP-TEST","topic":"Test","description":"delete me","time":"15m","confirm":true}}}' \
  | node dist/index.js
```
Expected: a `created` result with a note id. Then call `accelo_list_my_time` (should include it), `accelo_edit_time` (change to `30m`), and `accelo_delete_time` with `confirm:true` (removes it). Confirm in the Accelo UI that nothing test-related remains. If `deleteWorkLog` errors on the note id, the workLogId is distinct — adjust `time-delete.ts` to resolve it (and note the finding).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document time-tracking tools and write-safety model"
```

---

## Notes for the implementer

- **ESM/NodeNext:** local imports use `.js` extensions.
- **Enums via variables only:** never inline enum literals into a query string; pass them as string values inside `variables` (the client already sends variables) — the GraphQL layer coerces them.
- **`AcceloClient` now has `mutate`:** any test that constructs a fake client must include both `query` and `mutate` (see examples).
- **Preview-first invariant:** a write tool must not call `client.mutate` when `confirm` is falsy. Tests assert this — keep it true.
- **No new mutation paths:** do not add mutations to `accelo_graphql` or any read tool. The only `mutate` callers are the four time tools.
