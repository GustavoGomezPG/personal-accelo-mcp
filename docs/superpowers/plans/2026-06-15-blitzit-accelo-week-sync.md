# Blitzit → Accelo weekly time sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `accelo_sync_blitzit_week` tool that reads a week of completed Blitzit tasks from Firestore and logs them to Accelo as time entries, with preview/confirm and dedup.

**Architecture:** A new `src/blitzit/` layer (auth → Firestore client → task fetch/normalize → mapping → pure plan builder) feeds Accelo's existing logging core, which is refactored out of `time-log.ts` into `src/tools/time-core.ts` so both `accelo_log_time` and the new tool share scheduling + mutation. The tool is thin orchestration; all logic lives in pure, unit-tested functions.

**Tech Stack:** TypeScript (NodeNext ESM, `.js` import specifiers), `@modelcontextprotocol/sdk`, `zod`, native `fetch`, Vitest. Node 22 (native `fetch`, `node:fs`).

---

## File Structure

**Create:**
- `src/tools/time-core.ts` — `PreparedEntry`, `scheduleAndLogDay()` (extracted scheduling+mutation core).
- `src/blitzit/auth.ts` — `FIREBASE_API_KEY`, `extractRefreshToken()` (pure), `mintIdToken()`, `getBlitzitAuth()`.
- `src/blitzit/client.ts` — `BlitzitClient` interface, `createBlitzitClient()`, `FIRESTORE_PROJECT`.
- `src/blitzit/tasks.ts` — `BlitzitTask`, `decodeEntities()`, `parseDescription()`, `normalizeTask()`, `fetchOwnerTasks()`.
- `src/blitzit/mapping.ts` — `MappingEntry`, `Mapping`, `parseMapping()`, `resolveMapping()`, `loadMapping()`.
- `src/blitzit/plan.ts` — `SyncPlan`, `DayPlan`, `planSync()` (pure).
- `src/tools/blitzit-sync.ts` — `buildBlitzitSyncTool()`.
- `config/blitzit-accelo-map.example.json` — seed map.
- Tests: `src/blitzit/auth.test.ts`, `src/blitzit/tasks.test.ts`, `src/blitzit/mapping.test.ts`, `src/blitzit/plan.test.ts`, `src/tools/blitzit-sync.test.ts`.

**Modify:**
- `src/tools/time-log.ts` — use `scheduleAndLogDay`.
- `src/accelo/tz.ts` — export `epochToDateInTz()`.
- `src/tools/register.ts` — register the new tool.
- `src/tools/register.test.ts` — expected count 16 → 17.
- `README.md` — document the tool + map file + desktop-app requirement.

---

## Task 1: Extract Accelo logging core (`time-core.ts`)

**Files:**
- Create: `src/tools/time-core.ts`
- Modify: `src/tools/time-log.ts`
- Test: existing `src/tools/time-log.test.ts` is the regression guard (no new test file).

- [ ] **Step 1: Create the core module**

Create `src/tools/time-core.ts`:

```ts
import type { AcceloClient } from "../accelo/client.js";
import { formatDuration } from "../accelo/time.js";
import { fetchMyWorkLogs, entryEnd } from "../accelo/worklogs.js";
import { zonedDateTimeToEpoch, dayRangeEpoch, epochToHmInTz } from "../accelo/tz.js";

const LOG_MUTATION = `mutation Log($input: createWorkLogArgs!) { createWorkLogNote(input: $input) { id subject } }`;

export interface PreparedEntry {
  objectId: number;
  objectType: string;
  subject: string;
  body: string;
  seconds: number;
  billable: boolean;
  workTypeId?: number;
}

export interface ScheduleRow {
  subject: string;
  against: { id: number; type: string };
  start: string;
  end: string;
  loggedTime: string;
  billable: boolean;
}

export interface CreatedRow { id: string; subject: string; start: string; loggedTime: string }

export interface DayResult {
  resumedAfterExisting: boolean;
  schedule: ScheduleRow[];
  created: CreatedRow[] | null;
}

/** Schedule prepared entries back-to-back for one local day and optionally log them. */
export async function scheduleAndLogDay(
  client: AcceloClient,
  params: { tz: string; staffId: string; workdayStartHour: number; date: string; prepared: PreparedEntry[]; confirm: boolean },
): Promise<DayResult> {
  const { tz, staffId, workdayStartHour, date, prepared, confirm } = params;

  const workdayStart = zonedDateTimeToEpoch(date, workdayStartHour, 0, tz);
  const { start, endExclusive } = dayRangeEpoch(date, tz);
  const existing = await fetchMyWorkLogs(client, start, endExclusive, staffId);
  const latestEnd = existing.reduce((max, e) => Math.max(max, entryEnd(e)), 0);
  const resumedAfterExisting = existing.length > 0 && latestEnd > workdayStart;
  let cursor = Math.max(workdayStart, latestEnd);

  const scheduled = prepared.map((p) => {
    const startEpoch = cursor;
    cursor += p.seconds;
    return { ...p, startEpoch, endEpoch: cursor };
  });

  const schedule: ScheduleRow[] = scheduled.map((s) => ({
    subject: s.subject,
    against: { id: s.objectId, type: s.objectType },
    start: epochToHmInTz(s.startEpoch, tz),
    end: epochToHmInTz(s.endEpoch, tz),
    loggedTime: formatDuration(s.seconds),
    billable: s.billable,
  }));

  if (!confirm) return { resumedAfterExisting, schedule, created: null };

  const created: CreatedRow[] = [];
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
  return { resumedAfterExisting, schedule, created };
}
```

- [ ] **Step 2: Rewrite `time-log.ts` to use the core**

Replace the body of `src/tools/time-log.ts` with:

```ts
import { z } from "zod";
import type { AcceloClient } from "../accelo/client.js";
import type { AcceloConfig } from "../config.js";
import type { ToolDescriptor } from "./factory.js";
import { text } from "./util.js";
import { parseDuration } from "../accelo/time.js";
import { buildSubject } from "../accelo/nomenclature.js";
import { getCurrentUser } from "../accelo/identity.js";
import { todayInTz } from "../accelo/tz.js";
import { scheduleAndLogDay, type PreparedEntry } from "./time-core.js";

const OBJECT_TYPES = ["task", "ticket", "project", "milestone", "retainer", "sale"] as const;

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
      const prepared: PreparedEntry[] = (args.entries as Array<z.infer<typeof entrySchema>>).map((e) => ({
        objectId: e.objectId,
        objectType: e.objectType ?? "task",
        subject: buildSubject(e.projectLabel, e.topic, e.description),
        body: e.description,
        seconds: parseDuration(e.time),
        billable: e.billable ?? true,
        workTypeId: e.workTypeId,
      }));

      const user = await getCurrentUser(client);
      const tz = config.workdayTz ?? user.timezone ?? "UTC";
      const date = args.date ?? todayInTz(tz);

      const r = await scheduleAndLogDay(client, {
        tz, staffId: user.staffId, workdayStartHour: config.workdayStartHour, date, prepared, confirm: !!args.confirm,
      });

      if (!args.confirm) {
        return text({ preview: true, date, tz, resumedAfterExisting: r.resumedAfterExisting, willLog: "Set confirm:true to log these entries.", entries: r.schedule });
      }
      return text({ logged: true, date, tz, resumedAfterExisting: r.resumedAfterExisting, created: r.created });
    },
  };
}
```

- [ ] **Step 3: Run the existing time-log tests (regression)**

Run: `npx vitest run src/tools/time-log.test.ts`
Expected: PASS (all 5 cases — preview, sequential mutations, resume, abort-on-bad-duration).

- [ ] **Step 4: Build to confirm types**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/tools/time-core.ts src/tools/time-log.ts
git commit -m "refactor: extract scheduleAndLogDay core from time-log"
```

---

## Task 2: Blitzit description parser + task normalizer

**Files:**
- Create: `src/blitzit/tasks.ts`
- Test: `src/blitzit/tasks.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/blitzit/tasks.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseDescription, normalizeTask, decodeEntities } from "./tasks.js";

describe("decodeEntities", () => {
  it("decodes common HTML entities", () => {
    expect(decodeEntities("A &amp; B &lt;x&gt; &quot;q&quot; &#39;y&#39;")).toBe('A & B <x> "q" \'y\'');
  });
});

describe("parseDescription", () => {
  it("splits <strong>topic</strong><br>detail", () => {
    expect(parseDescription("<strong>Website</strong><br>Fixed the header")).toEqual({ topic: "Website", detail: "Fixed the header" });
  });
  it("strips nested tags and decodes entities in detail", () => {
    expect(parseDescription('<strong>Website</strong><br>Updated <a href="x">link</a> &amp; more')).toEqual({ topic: "Website", detail: "Updated link & more" });
  });
  it("handles missing <strong> by leaving topic empty", () => {
    expect(parseDescription("just some text")).toEqual({ topic: "", detail: "just some text" });
  });
  it("handles empty input", () => {
    expect(parseDescription("")).toEqual({ topic: "", detail: "" });
  });
});

describe("normalizeTask", () => {
  it("maps Firestore fields to a BlitzitTask", () => {
    const fields = {
      title: { stringValue: "Datamax" },
      description: { stringValue: "<strong>Website</strong><br>DNS work" },
      timeTaken: { integerValue: "28800000" },
      endTime: { integerValue: "1780934026000" },
      listId: { stringValue: "VJ46SaipqK2ikg3aoi1i" },
      board: { stringValue: "done" },
    };
    expect(normalizeTask("abc", fields)).toEqual({
      id: "abc", project: "Datamax", topic: "Website", detail: "DNS work",
      seconds: 28800, endTimeMs: 1780934026000, listId: "VJ46SaipqK2ikg3aoi1i", board: "done",
    });
  });
  it("defaults missing numbers/strings safely", () => {
    expect(normalizeTask("x", { title: { stringValue: "Internal" } })).toEqual({
      id: "x", project: "Internal", topic: "", detail: "", seconds: 0, endTimeMs: 0, listId: null, board: "",
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/blitzit/tasks.test.ts`
Expected: FAIL ("Cannot find module './tasks.js'").

- [ ] **Step 3: Implement `tasks.ts` (pure parts)**

Create `src/blitzit/tasks.ts`:

```ts
export interface BlitzitTask {
  id: string;
  project: string;
  topic: string;
  detail: string;
  seconds: number;
  endTimeMs: number;
  listId: string | null;
  board: string;
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

/** Blitzit description is "<strong>topic</strong><br>detail". */
export function parseDescription(html: string): { topic: string; detail: string } {
  const input = html ?? "";
  const strong = input.match(/<strong>([\s\S]*?)<\/strong>/i);
  const topic = strong ? stripTags(strong[1]) : "";
  const rest = strong ? input.slice(input.indexOf(strong[0]) + strong[0].length) : input;
  const detail = stripTags(rest);
  return { topic, detail };
}

type FsFields = Record<string, { stringValue?: string; integerValue?: string }>;

function str(f: FsFields, key: string): string { return f[key]?.stringValue ?? ""; }
function int(f: FsFields, key: string): number { const v = f[key]?.integerValue; return v ? Number(v) : 0; }

export function normalizeTask(id: string, fields: FsFields): BlitzitTask {
  const { topic, detail } = parseDescription(str(fields, "description"));
  return {
    id,
    project: str(fields, "title"),
    topic,
    detail,
    seconds: Math.round(int(fields, "timeTaken") / 1000),
    endTimeMs: int(fields, "endTime"),
    listId: fields.listId?.stringValue ?? null,
    board: str(fields, "board"),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/blitzit/tasks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/blitzit/tasks.ts src/blitzit/tasks.test.ts
git commit -m "feat: blitzit task description parser and normalizer"
```

---

## Task 3: Mapping loader/resolver + example config

**Files:**
- Create: `src/blitzit/mapping.ts`, `config/blitzit-accelo-map.example.json`
- Test: `src/blitzit/mapping.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/blitzit/mapping.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseMapping, resolveMapping } from "./mapping.js";

describe("parseMapping", () => {
  it("parses a valid map", () => {
    const m = parseMapping('{"Datamax":{"objectType":"task","objectId":123,"billable":false}}');
    expect(m.Datamax).toEqual({ objectType: "task", objectId: 123, billable: false });
  });
  it("rejects non-object JSON", () => {
    expect(() => parseMapping("[]")).toThrow(/object/i);
  });
  it("rejects an entry missing objectId", () => {
    expect(() => parseMapping('{"X":{"objectType":"task"}}')).toThrow(/objectId/i);
  });
  it("rejects an entry with a non-integer objectId", () => {
    expect(() => parseMapping('{"X":{"objectType":"task","objectId":"7"}}')).toThrow(/objectId/i);
  });
});

describe("resolveMapping", () => {
  const m = { Datamax: { objectType: "task", objectId: 1 } };
  it("returns the entry for a known project", () => {
    expect(resolveMapping(m, "Datamax")).toEqual({ objectType: "task", objectId: 1 });
  });
  it("returns undefined for an unknown project", () => {
    expect(resolveMapping(m, "Nope")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/blitzit/mapping.test.ts`
Expected: FAIL ("Cannot find module './mapping.js'").

- [ ] **Step 3: Implement `mapping.ts`**

Create `src/blitzit/mapping.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface MappingEntry {
  objectType: string;
  objectId: number;
  billable?: boolean;
  workTypeId?: number;
}
export type Mapping = Record<string, MappingEntry>;

export function parseMapping(json: string): Mapping {
  const raw: unknown = JSON.parse(json);
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Blitzit→Accelo map must be a JSON object of { projectName: { objectType, objectId } }.");
  }
  const out: Mapping = {};
  for (const [name, val] of Object.entries(raw as Record<string, unknown>)) {
    if (val === null || typeof val !== "object") throw new Error(`Map entry "${name}" must be an object.`);
    const e = val as Record<string, unknown>;
    if (typeof e.objectType !== "string" || !e.objectType) throw new Error(`Map entry "${name}" needs a string objectType.`);
    if (typeof e.objectId !== "number" || !Number.isInteger(e.objectId)) throw new Error(`Map entry "${name}" needs an integer objectId.`);
    const entry: MappingEntry = { objectType: e.objectType, objectId: e.objectId };
    if (typeof e.billable === "boolean") entry.billable = e.billable;
    if (typeof e.workTypeId === "number" && Number.isInteger(e.workTypeId)) entry.workTypeId = e.workTypeId;
    out[name] = entry;
  }
  return out;
}

export function resolveMapping(map: Mapping, project: string): MappingEntry | undefined {
  return map[project];
}

export function defaultMapPath(): string {
  return process.env.BLITZIT_ACCELO_MAP ?? fileURLToPath(new URL("../../config/blitzit-accelo-map.json", import.meta.url));
}

export function loadMapping(path: string = defaultMapPath()): Mapping {
  let json: string;
  try {
    json = readFileSync(path, "utf8");
  } catch {
    throw new Error(`Blitzit→Accelo map not found at ${path}. Copy config/blitzit-accelo-map.example.json to that location and fill in Accelo object ids, or set BLITZIT_ACCELO_MAP.`);
  }
  return parseMapping(json);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/blitzit/mapping.test.ts`
Expected: PASS.

- [ ] **Step 5: Create the example config**

Create `config/blitzit-accelo-map.example.json` (replace each `0` with the real Accelo object id; set `objectType` per project, default `"task"`):

```json
{
  "AlligatorTPMS": { "objectType": "task", "objectId": 0 },
  "Elite Dental Alliance": { "objectType": "task", "objectId": 0 },
  "Houston Eye": { "objectType": "task", "objectId": 0 },
  "Elite Enterprise": { "objectType": "task", "objectId": 0 },
  "CMHoF": { "objectType": "task", "objectId": 0 },
  "Velocity1": { "objectType": "task", "objectId": 0 },
  "ConsiderItDone": { "objectType": "task", "objectId": 0 },
  "OptimizedIT": { "objectType": "task", "objectId": 0 },
  "AgentDealer": { "objectType": "task", "objectId": 0 },
  "Cadco": { "objectType": "task", "objectId": 0 },
  "Brownland Farm": { "objectType": "task", "objectId": 0 },
  "Datamax": { "objectType": "task", "objectId": 0 },
  "RJYoung": { "objectType": "task", "objectId": 0 },
  "CAIA Connect": { "objectType": "task", "objectId": 0 },
  "Provisions Group": { "objectType": "task", "objectId": 0 },
  "InsideARM": { "objectType": "task", "objectId": 0 },
  "Elite Dental Enterprise": { "objectType": "task", "objectId": 0 },
  "Internal": { "objectType": "task", "objectId": 0 }
}
```

- [ ] **Step 6: Commit**

```bash
git add src/blitzit/mapping.ts src/blitzit/mapping.test.ts config/blitzit-accelo-map.example.json
git commit -m "feat: blitzit→accelo project mapping loader + example config"
```

---

## Task 4: Blitzit auth (refresh-token extraction + ID-token mint)

**Files:**
- Create: `src/blitzit/auth.ts`
- Test: `src/blitzit/auth.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/blitzit/auth.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractRefreshToken } from "./auth.js";

describe("extractRefreshToken", () => {
  it("finds an AMf- token in a binary-ish blob", () => {
    const rt = "AMf-" + "a".repeat(180);
    const blob = `\x00\x10garbage"refreshToken"\x00${rt}\x07more`;
    expect(extractRefreshToken(blob)).toBe(rt);
  });
  it("returns the longest AMf- token when several are present", () => {
    const short = "AMf-" + "b".repeat(60);
    const long = "AMf-" + "c".repeat(200);
    expect(extractRefreshToken(`${short} ... ${long}`)).toBe(long);
  });
  it("throws when no token is present", () => {
    expect(() => extractRefreshToken("nothing here")).toThrow(/token/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/blitzit/auth.test.ts`
Expected: FAIL ("Cannot find module './auth.js'").

- [ ] **Step 3: Implement `auth.ts`**

Create `src/blitzit/auth.ts`:

```ts
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const FIREBASE_API_KEY = "AIzaSyBfWWxV-jps9AOAS5eSIFx8cXl_BeMOb7U";

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
  const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`, {
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/blitzit/auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/blitzit/auth.ts src/blitzit/auth.test.ts
git commit -m "feat: blitzit auth (refresh-token extraction + id-token mint)"
```

---

## Task 5: Firestore client + week task fetch

**Files:**
- Create: `src/blitzit/client.ts`
- Modify: `src/blitzit/tasks.ts` (add `fetchOwnerTasks`)
- Test: `src/blitzit/tasks.test.ts` (add a fetch test with a mock client)

- [ ] **Step 1: Implement the Firestore client**

Create `src/blitzit/client.ts`:

```ts
export const FIRESTORE_PROJECT = "blitzitapp1";
const BASE = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents`;

export interface FirestoreDoc { id: string; fields: Record<string, any> }

export interface BlitzitClient {
  /** Run a structuredQuery against the `tasks` collection, returning documents. */
  queryTasksByOwner(uid: string): Promise<FirestoreDoc[]>;
}

export function createBlitzitClient(idToken: string): BlitzitClient {
  return {
    async queryTasksByOwner(uid: string): Promise<FirestoreDoc[]> {
      const body = {
        structuredQuery: {
          from: [{ collectionId: "tasks" }],
          where: { fieldFilter: { field: { fieldPath: "owner" }, op: "EQUAL", value: { stringValue: uid } } },
        },
      };
      const res = await fetch(`${BASE}:runQuery`, {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Blitzit Firestore query failed (HTTP ${res.status}).`);
      const rows = (await res.json()) as Array<{ document?: { name: string; fields: Record<string, any> } }>;
      return rows
        .filter((r) => r.document)
        .map((r) => ({ id: r.document!.name.split("/documents/")[1].split("/").pop()!, fields: r.document!.fields }));
    },
  };
}
```

> **Implementation note:** the `owner` field name is assumed from inspecting imported task docs. Before relying on it, verify by running once against a known account; if tasks come back empty, check whether the field is `userId` and adjust the `fieldPath` here. A single-field equality filter avoids needing a Firestore composite index; `board`/`endTime`/`listId` are filtered client-side in `fetchOwnerTasks`.

- [ ] **Step 2: Write the failing fetch test**

Append to `src/blitzit/tasks.test.ts`:

```ts
import { fetchWeekDoneTasks } from "./tasks.js";
import type { BlitzitClient, FirestoreDoc } from "./client.js";

function mockClient(docs: FirestoreDoc[]): BlitzitClient {
  return { queryTasksByOwner: async () => docs };
}
const doc = (id: string, title: string, board: string, endTimeMs: number, listId = "L1"): FirestoreDoc => ({
  id, fields: {
    title: { stringValue: title }, board: { stringValue: board },
    description: { stringValue: "<strong>Web</strong><br>x" }, timeTaken: { integerValue: "3600000" },
    endTime: { integerValue: String(endTimeMs) }, listId: { stringValue: listId },
  },
});

describe("fetchWeekDoneTasks", () => {
  it("keeps only done tasks whose endTime is within [fromMs, toMs)", async () => {
    const c = mockClient([
      doc("a", "Datamax", "done", 1000),
      doc("b", "Datamax", "done", 5000),     // out of range
      doc("c", "Datamax", "todo", 1500),     // not done
    ]);
    const out = await fetchWeekDoneTasks(c, "uid", 500, 2000);
    expect(out.map((t) => t.id)).toEqual(["a"]);
  });
  it("filters by listId when provided", async () => {
    const c = mockClient([doc("a", "Datamax", "done", 1000, "L1"), doc("b", "Datamax", "done", 1100, "L2")]);
    const out = await fetchWeekDoneTasks(c, "uid", 0, 5000, "L2");
    expect(out.map((t) => t.id)).toEqual(["b"]);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/blitzit/tasks.test.ts`
Expected: FAIL ("fetchWeekDoneTasks is not a function" / no export).

- [ ] **Step 4: Implement `fetchWeekDoneTasks` in `tasks.ts`**

Append to `src/blitzit/tasks.ts`:

```ts
import type { BlitzitClient } from "./client.js";

/** Owner's done tasks whose endTime is in [fromMs, toMs), optionally filtered by Blitzit listId. */
export async function fetchWeekDoneTasks(
  client: BlitzitClient, uid: string, fromMs: number, toMs: number, listId?: string,
): Promise<BlitzitTask[]> {
  const docs = await client.queryTasksByOwner(uid);
  return docs
    .map((d) => normalizeTask(d.id, d.fields))
    .filter((t) => t.board === "done" && t.endTimeMs >= fromMs && t.endTimeMs < toMs && (!listId || t.listId === listId))
    .sort((a, b) => a.endTimeMs - b.endTimeMs);
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/blitzit/tasks.test.ts`
Expected: PASS (all parser, normalizer, and fetch cases).

- [ ] **Step 6: Build + commit**

```bash
npm run build
git add src/blitzit/client.ts src/blitzit/tasks.ts src/blitzit/tasks.test.ts
git commit -m "feat: blitzit firestore client and week done-task fetch"
```

---

## Task 6: tz helper + pure plan builder

**Files:**
- Modify: `src/accelo/tz.ts` (export `epochToDateInTz`)
- Create: `src/blitzit/plan.ts`
- Test: `src/blitzit/plan.test.ts`

- [ ] **Step 1: Export `epochToDateInTz` from `tz.ts`**

Add to the end of `src/accelo/tz.ts`:

```ts
/** Date (YYYY-MM-DD) of an epoch (seconds) in `tz`. */
export function epochToDateInTz(epochSeconds: number, tz: string): string {
  return epochToYmdInTz(epochSeconds, tz);
}
```

- [ ] **Step 2: Write the failing test**

Create `src/blitzit/plan.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { planSync } from "./plan.js";
import type { BlitzitTask } from "./tasks.js";

const TZ = "America/Los_Angeles";
// 2026-06-08 ~08:00 PDT
const jun8 = Date.UTC(2026, 5, 8, 15, 0, 0);
const task = (id: string, project: string, seconds: number, endTimeMs: number, topic = "Web", detail = "did x"): BlitzitTask =>
  ({ id, project, topic, detail, seconds, endTimeMs, listId: "L1", board: "done" });

describe("planSync", () => {
  it("groups mapped tasks by local day and builds prepared entries", () => {
    const tasks = [task("a", "Datamax", 3600, jun8), task("b", "Datamax", 1800, jun8 + 3_600_000)];
    const plan = planSync({ tasks, mapping: { Datamax: { objectType: "task", objectId: 7 } }, existingKeys: new Set(), tz: TZ });
    expect(plan.days).toHaveLength(1);
    expect(plan.days[0].date).toBe("2026-06-08");
    expect(plan.days[0].prepared.map((p) => [p.subject, p.seconds, p.objectId])).toEqual([
      ["Datamax :: Web :: did x", 3600, 7],
      ["Datamax :: Web :: did x", 1800, 7],
    ]);
  });
  it("reports unmapped projects and never logs them", () => {
    const plan = planSync({ tasks: [task("a", "Nope", 3600, jun8)], mapping: {}, existingKeys: new Set(), tz: TZ });
    expect(plan.days).toHaveLength(0);
    expect(plan.unmapped).toEqual([{ project: "Nope", count: 1 }]);
  });
  it("skips zero-duration tasks", () => {
    const plan = planSync({ tasks: [task("a", "Datamax", 0, jun8)], mapping: { Datamax: { objectType: "task", objectId: 7 } }, existingKeys: new Set(), tz: TZ });
    expect(plan.days).toHaveLength(0);
    expect(plan.skippedZero).toEqual([{ id: "a", project: "Datamax" }]);
  });
  it("skips duplicates already present in Accelo (day + subject)", () => {
    const tasks = [task("a", "Datamax", 3600, jun8)];
    const existingKeys = new Set(["2026-06-08 Datamax :: Web :: did x"]);
    const plan = planSync({ tasks, mapping: { Datamax: { objectType: "task", objectId: 7 } }, existingKeys, tz: TZ });
    expect(plan.days).toHaveLength(0);
    expect(plan.skippedDuplicates).toEqual([{ date: "2026-06-08", subject: "Datamax :: Web :: did x" }]);
  });
  it("fills empty topic/detail so the subject is always valid", () => {
    const plan = planSync({ tasks: [task("a", "Datamax", 60, jun8, "", "")], mapping: { Datamax: { objectType: "task", objectId: 7 } }, existingKeys: new Set(), tz: TZ });
    expect(plan.days[0].prepared[0].subject).toBe("Datamax :: General :: Datamax");
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/blitzit/plan.test.ts`
Expected: FAIL ("Cannot find module './plan.js'").

- [ ] **Step 4: Implement `plan.ts`**

Create `src/blitzit/plan.ts`:

```ts
import { buildSubject } from "../accelo/nomenclature.js";
import { epochToDateInTz } from "../accelo/tz.js";
import type { PreparedEntry } from "../tools/time-core.js";
import type { BlitzitTask } from "./tasks.js";
import { resolveMapping, type Mapping } from "./mapping.js";

export interface DayPlan { date: string; prepared: PreparedEntry[] }
export interface SyncPlan {
  days: DayPlan[];
  unmapped: Array<{ project: string; count: number }>;
  skippedZero: Array<{ id: string; project: string }>;
  skippedDuplicates: Array<{ date: string; subject: string }>;
}

export const DEDUP_SEP = " ";

export function planSync(params: {
  tasks: BlitzitTask[];
  mapping: Mapping;
  existingKeys: Set<string>; // `${date}${DEDUP_SEP}${subject}`
  tz: string;
}): SyncPlan {
  const { tasks, mapping, existingKeys, tz } = params;
  const byDay = new Map<string, PreparedEntry[]>();
  const unmappedCounts = new Map<string, number>();
  const skippedZero: SyncPlan["skippedZero"] = [];
  const skippedDuplicates: SyncPlan["skippedDuplicates"] = [];

  for (const t of [...tasks].sort((a, b) => a.endTimeMs - b.endTimeMs)) {
    const entry = resolveMapping(mapping, t.project);
    if (!entry) { unmappedCounts.set(t.project, (unmappedCounts.get(t.project) ?? 0) + 1); continue; }
    if (t.seconds <= 0) { skippedZero.push({ id: t.id, project: t.project }); continue; }

    const topic = t.topic || "General";
    const detail = t.detail || t.topic || t.project;
    const subject = buildSubject(t.project, topic, detail);
    const date = epochToDateInTz(Math.floor(t.endTimeMs / 1000), tz);

    if (existingKeys.has(`${date}${DEDUP_SEP}${subject}`)) { skippedDuplicates.push({ date, subject }); continue; }

    const prepared: PreparedEntry = {
      objectId: entry.objectId,
      objectType: entry.objectType,
      subject,
      body: detail,
      seconds: t.seconds,
      billable: entry.billable ?? true,
      workTypeId: entry.workTypeId,
    };
    if (!byDay.has(date)) byDay.set(date, []);
    byDay.get(date)!.push(prepared);
  }

  const days: DayPlan[] = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, prepared]) => ({ date, prepared }));
  const unmapped = [...unmappedCounts.entries()].map(([project, count]) => ({ project, count }));
  return { days, unmapped, skippedZero, skippedDuplicates };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/blitzit/plan.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/accelo/tz.ts src/blitzit/plan.ts src/blitzit/plan.test.ts
git commit -m "feat: pure blitzit→accelo sync plan builder + tz date helper"
```

---

## Task 7: The tool + registration

**Files:**
- Create: `src/tools/blitzit-sync.ts`
- Modify: `src/tools/register.ts`, `src/tools/register.test.ts`
- Test: `src/tools/blitzit-sync.test.ts`

- [ ] **Step 1: Implement the tool**

Create `src/tools/blitzit-sync.ts`:

```ts
import { z } from "zod";
import type { AcceloClient } from "../accelo/client.js";
import type { AcceloConfig } from "../config.js";
import type { ToolDescriptor } from "./factory.js";
import { text } from "./util.js";
import { getCurrentUser } from "../accelo/identity.js";
import { fetchMyWorkLogs } from "../accelo/worklogs.js";
import { currentWeekRange } from "../accelo/dates.js";
import { zonedDateTimeToEpoch, epochToDateInTz } from "../accelo/tz.js";
import { scheduleAndLogDay } from "./time-core.js";
import { getBlitzitAuth } from "../blitzit/auth.js";
import { createBlitzitClient } from "../blitzit/client.js";
import { fetchWeekDoneTasks } from "../blitzit/tasks.js";
import { loadMapping } from "../blitzit/mapping.js";
import { planSync, DEDUP_SEP } from "../blitzit/plan.js";

export function buildBlitzitSyncTool(client: AcceloClient, config: AcceloConfig): ToolDescriptor {
  return {
    name: "accelo_sync_blitzit_week",
    description:
      "Extract a week of completed Blitzit tasks (by completion date) and log them to Accelo as time entries, using a Blitzit-project→Accelo-object mapping. Preview by default; pass confirm:true to log. Skips unmapped projects, zero-duration tasks, and entries already logged in Accelo for the same day+subject.",
    inputSchema: {
      from: z.string().optional().describe("Start date YYYY-MM-DD (default Monday of current week)."),
      to: z.string().optional().describe("End date YYYY-MM-DD inclusive (default Sunday of current week)."),
      listId: z.string().optional().describe("Optional Blitzit list id to filter tasks."),
      confirm: z.boolean().optional().describe("Set true to actually log; otherwise returns a preview."),
    },
    handler: async (args) => {
      const week = currentWeekRange();
      const from = args.from ?? week.from;
      const to = args.to ?? week.to;

      const user = await getCurrentUser(client);
      const tz = config.workdayTz ?? user.timezone ?? "UTC";

      // Blitzit task window in the user's timezone (endTime is absolute ms).
      const fromMs = zonedDateTimeToEpoch(from, 0, 0, tz) * 1000;
      const toMs = (zonedDateTimeToEpoch(to, 0, 0, tz) + 86400) * 1000; // exclusive end of `to`

      const { idToken, uid } = await getBlitzitAuth();
      const tasks = await fetchWeekDoneTasks(createBlitzitClient(idToken), uid, fromMs, toMs, args.listId);

      const mapping = loadMapping();

      // Existing Accelo entries across the week → dedup keys "date subject".
      const fromEpoch = zonedDateTimeToEpoch(from, 0, 0, tz);
      const toEpochExclusive = zonedDateTimeToEpoch(to, 0, 0, tz) + 86400;
      const existing = await fetchMyWorkLogs(client, fromEpoch, toEpochExclusive, user.staffId, 100);
      const existingKeys = new Set(existing.map((e) => `${epochToDateInTz(e.startEpoch, tz)}${DEDUP_SEP}${e.subject}`));

      const plan = planSync({ tasks, mapping, existingKeys, tz });

      const confirm = !!args.confirm;
      const days: Array<Record<string, unknown>> = [];
      for (const day of plan.days) {
        const r = await scheduleAndLogDay(client, {
          tz, staffId: user.staffId, workdayStartHour: config.workdayStartHour, date: day.date, prepared: day.prepared, confirm,
        });
        days.push(confirm
          ? { date: day.date, logged: r.created?.length ?? 0, created: r.created }
          : { date: day.date, entries: r.schedule });
      }

      return text({
        mode: confirm ? "logged" : "preview",
        from, to, tz,
        taskCount: tasks.length,
        days,
        unmapped: plan.unmapped,
        skippedZero: plan.skippedZero,
        skippedDuplicates: plan.skippedDuplicates,
        ...(confirm ? {} : { willLog: "Set confirm:true to log these entries." }),
      });
    },
  };
}
```

- [ ] **Step 2: Write the failing tool test**

Create `src/tools/blitzit-sync.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../blitzit/auth.js", () => ({ getBlitzitAuth: vi.fn(async () => ({ idToken: "t", uid: "u" })) }));
vi.mock("../blitzit/client.js", () => ({ createBlitzitClient: vi.fn(() => ({ queryTasksByOwner: vi.fn() })) }));
vi.mock("../blitzit/mapping.js", () => ({ loadMapping: vi.fn(() => ({ Datamax: { objectType: "task", objectId: 7 } })) }));

const jun8 = Date.UTC(2026, 5, 8, 15, 0, 0); // ~08:00 PDT
vi.mock("../blitzit/tasks.js", () => ({
  fetchWeekDoneTasks: vi.fn(async () => [
    { id: "a", project: "Datamax", topic: "Web", detail: "dns", seconds: 3600, endTimeMs: jun8, listId: "L1", board: "done" },
    { id: "b", project: "Nope", topic: "Web", detail: "x", seconds: 3600, endTimeMs: jun8, listId: "L1", board: "done" },
  ]),
}));

import { buildBlitzitSyncTool } from "./blitzit-sync.js";
import type { AcceloClient } from "../accelo/client.js";
import type { AcceloConfig } from "../config.js";

const config = { deployment: "d", sessionCookie: "c", endpoint: "e", workdayStartHour: 8, workdayTz: "America/Los_Angeles" } as AcceloConfig;
const LA_ME = { acceloConfig: { userConfig: { currentUser: { __typename: "Staff", id: "482", timezone: "America/Los_Angeles" } } } };
const EMPTY_NOTES = { notes: { edges: [] } };

function client(): AcceloClient {
  return { query: vi.fn() as any, mutate: vi.fn().mockResolvedValue({ createWorkLogNote: { id: "n", subject: "s" } }) as any };
}

describe("accelo_sync_blitzit_week", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is named correctly", () => {
    expect(buildBlitzitSyncTool(client(), config).name).toBe("accelo_sync_blitzit_week");
  });

  it("previews mapped tasks, reports unmapped, and writes nothing", async () => {
    const c = client();
    // getCurrentUser, then fetchMyWorkLogs (dedup)
    (c.query as any).mockResolvedValueOnce(LA_ME).mockResolvedValueOnce(EMPTY_NOTES);
    const res = await buildBlitzitSyncTool(c, config).handler({ from: "2026-06-08", to: "2026-06-14" });
    const p = JSON.parse(res.content[0].text);
    expect(p.mode).toBe("preview");
    expect(p.days).toHaveLength(1);
    expect(p.days[0].date).toBe("2026-06-08");
    expect(p.days[0].entries[0].subject).toBe("Datamax :: Web :: dns");
    expect(p.unmapped).toEqual([{ project: "Nope", count: 1 }]);
    expect(c.mutate).not.toHaveBeenCalled();
  });

  it("logs when confirm:true", async () => {
    const c = client();
    // getCurrentUser, fetchMyWorkLogs (dedup), then per-day scheduleAndLogDay's fetchMyWorkLogs
    (c.query as any).mockResolvedValueOnce(LA_ME).mockResolvedValueOnce(EMPTY_NOTES).mockResolvedValueOnce(EMPTY_NOTES);
    const res = await buildBlitzitSyncTool(c, config).handler({ from: "2026-06-08", to: "2026-06-14", confirm: true });
    const p = JSON.parse(res.content[0].text);
    expect(p.mode).toBe("logged");
    expect((c.mutate as any).mock.calls).toHaveLength(1);
    expect((c.mutate as any).mock.calls[0][1].input.workLogSubject).toBe("Datamax :: Web :: dns");
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/tools/blitzit-sync.test.ts`
Expected: FAIL ("Cannot find module './blitzit-sync.js'").

- [ ] **Step 4: Register the tool**

In `src/tools/register.ts`, add the import and include it in `timeTools` (so the count becomes 17):

```ts
import { buildBlitzitSyncTool } from "./blitzit-sync.js";
```

Change the `timeTools` array to:

```ts
  const timeTools = [
    buildLogTimeTool(client, config),
    buildListTimeTool(client),
    buildEditTimeTool(client),
    buildDeleteTimeTool(client),
    buildBlitzitSyncTool(client, config),
  ];
```

- [ ] **Step 5: Update the register test count**

In `src/tools/register.test.ts`: change `expect(names.length).toBe(16);` to `expect(names.length).toBe(17);` and add `"accelo_sync_blitzit_week"` to the `for (const n of [...])` contains-list.

- [ ] **Step 6: Run the tool + register tests**

Run: `npx vitest run src/tools/blitzit-sync.test.ts src/tools/register.test.ts`
Expected: PASS.

- [ ] **Step 7: Full test suite + build**

Run: `npm test && npm run build`
Expected: all tests PASS, no TS errors.

- [ ] **Step 8: Commit**

```bash
git add src/tools/blitzit-sync.ts src/tools/blitzit-sync.test.ts src/tools/register.ts src/tools/register.test.ts
git commit -m "feat: accelo_sync_blitzit_week tool"
```

---

## Task 8: Docs

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the tool**

Add a section to `README.md`:

```markdown
## accelo_sync_blitzit_week

Logs a week of completed Blitzit tasks into Accelo as time entries.

- **Blitzit auth:** reads the Firebase refresh token from the local Blitzit **desktop app** (`~/Library/Application Support/blitzit/...`). The app must be installed and signed in on the same machine.
- **Mapping:** copy `config/blitzit-accelo-map.example.json` to `config/blitzit-accelo-map.json` (or set `BLITZIT_ACCELO_MAP`) and fill in each Blitzit project's Accelo `{objectType, objectId}` (optionally `billable`, `workTypeId`). Unmapped projects are reported, never logged.
- **Inputs:** `from`/`to` (YYYY-MM-DD, default current week Mon–Sun), `listId` (optional Blitzit list filter), `confirm` (default false = preview).
- **Safety:** preview by default; logs only with `confirm:true`; skips entries already logged in Accelo for the same day + subject; skips zero-duration tasks.
- **Time source:** Blitzit `timeTaken` per task; entries are scheduled back-to-back from the workday start per day (same engine as `accelo_log_time`).
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document accelo_sync_blitzit_week"
```

---

## Self-Review

**Spec coverage:** mapping table (Task 3), auto-read desktop token (Task 4), Firestore read + week filter (Task 5), HTML parse/normalize (Task 2), pure plan + dedup + unmapped/zero reporting (Task 6), preview/confirm tool + registration (Task 7), reuse of log core via refactor (Task 1), config artifact (Task 3), docs (Task 8), tests throughout. All spec sections covered.

**Placeholder scan:** none — every step has full code/commands.

**Type consistency:** `PreparedEntry` (time-core) is the single shared shape used by `time-log`, `plan`, and `blitzit-sync`. `BlitzitTask` (tasks) is consumed by `plan` and the fetch test. `Mapping`/`MappingEntry` (mapping) consumed by `plan`. `BlitzitClient`/`FirestoreDoc` (client) consumed by `tasks`. `DEDUP_SEP` exported from `plan` and reused by the tool. Names match across tasks.

**Known risk flagged for implementation:** the Blitzit `owner` field name (Task 5 note) — verify against a live account; switch to `userId` if the query returns empty.
