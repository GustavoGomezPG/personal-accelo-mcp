# Blitzit → Accelo weekly time sync

**Date:** 2026-06-15
**Status:** Approved (design)
**Component:** Accelo MCP — new tool `accelo_sync_blitzit_week`

## Goal

Add one tool to the Accelo MCP that extracts a week's completed Blitzit tasks and pushes them to Accelo as time-log entries, safely (preview + confirm + dedup).

## Background

- The Accelo MCP (TypeScript, `@modelcontextprotocol/sdk` v1.12.0) already has `accelo_log_time`, which logs entries against an Accelo object (`objectId` + `objectType`), formats the subject as `Project :: Topic :: Description`, schedules entries sequentially from the workday start (resuming after existing logged time), and supports preview/confirm. Auth to Accelo is a session cookie via env.
- Blitzit is a Firebase/Firestore app (project `blitzitapp1`). Tasks live in a top-level `tasks` collection. A completed task has `board:"done"`, `state:"done"`, `timeTaken` (ms), `endTime` (ms epoch = completion date), `title` (used as the project name in this workflow), `description` (HTML `"<strong>{topic}</strong><br>{detail}"`), `listId`, and an owner field.
- The Blitzit MCP cannot expose `endTime`, so the "week" filter must read Firestore directly. (See the user's memory `blitzit-integration-internals`.)

## Decisions (from brainstorming)

1. **Project mapping:** a config mapping table — Blitzit project name (= task `title`) → Accelo `{objectType, objectId, billable?, workTypeId?}`. Unmapped projects are reported, never logged.
2. **Blitzit auth:** auto-read the desktop app's local Firebase refresh token at runtime (no env setup).
3. **Safety:** preview by default; log only on `confirm:true`; dedup against existing Accelo entries for the week (skip same subject+day).

## Architecture

Single tool `accelo_sync_blitzit_week` orchestrating a pipeline. New `src/blitzit/` modules for Blitzit concerns; reuse Accelo's existing logging core (refactored out of `time-log.ts`).

### New modules — `src/blitzit/`

- **`auth.ts`** — `getBlitzitAuth(): Promise<{ idToken, uid }>`
  - Locate `~/Library/Application Support/blitzit/IndexedDB/app_._0.indexeddb.leveldb`, read its files, extract the refresh token via regex `AMf-[A-Za-z0-9_\-]{60,}` (longest match).
  - Mint an ID token: POST `https://securetoken.googleapis.com/v1/token?key=<FIREBASE_API_KEY>` with `grant_type=refresh_token&refresh_token=<rt>`; return `access_token` as `idToken` and `user_id` as `uid`.
  - Firebase web API key: supplied via the `BLITZIT_FIREBASE_API_KEY` env var (Blitzit's public, project-identifying key — not committed).
  - Errors: app dir/token not found → actionable message ("open/sign into the Blitzit desktop app").

- **`client.ts`** — Firestore REST helper
  - `runQuery(idToken, structuredQuery)` → POST `https://firestore.googleapis.com/v1/projects/blitzitapp1/databases/(default)/documents:runQuery`, Bearer idToken. Returns parsed documents.

- **`tasks.ts`** — `fetchWeekDoneTasks(idToken, uid, fromMs, toMs, listId?)`
  - structuredQuery on `tasks` where `owner == uid` AND `board == "done"` (verify exact owner field name during impl — `owner` vs `userId`); fetch, then filter `endTime` in `[fromMs, toMs]` and optional `listId`.
  - Normalize each → `BlitzitTask { id, project, topic, description, seconds, endTimeMs, listId }`:
    - `project` = task `title`
    - parse `description` HTML: `topic` = text inside first `<strong>…</strong>`; `detail` = remainder with tags stripped & entities decoded
    - `seconds` = `round(timeTaken / 1000)`
    - tasks with `seconds <= 0` are included but flagged (zero-duration) — caller decides; default skip with a note.

- **`mapping.ts`** — `loadMapping()` + `resolve(project)`
  - Load JSON from `process.env.BLITZIT_ACCELO_MAP` or default `config/blitzit-accelo-map.json` (relative to package root).
  - Shape: `{ "<project name>": { objectType: "task"|"ticket"|"project"|..., objectId: number, billable?: boolean, workTypeId?: number } }`.
  - `resolve(project)` → mapping entry or `undefined` (→ unmapped warning).

### Refactor — `src/tools/time-log.ts`

Extract the core (validate → fetch user/tz → fetch existing logs → schedule sequentially → preview or mutate) into a reusable function, e.g. `logDay(client, config, { date, entries, confirm })`, used by both `accelo_log_time` and the new tool. No behavior change to `accelo_log_time`.

### Tool — `src/tools/blitzit-sync.ts`

`buildBlitzitSyncTool(client, config): ToolDescriptor`

- **Name:** `accelo_sync_blitzit_week`
- **Input schema (zod):**
  - `from?: string` ("YYYY-MM-DD"), `to?: string` — default current week Mon–Sun in the user's Accelo timezone
  - `listId?: string` — optional Blitzit list filter
  - `confirm?: boolean` — default `false` (preview)
- **Handler flow:**
  1. `getBlitzitAuth()` → `{ idToken, uid }`
  2. compute week range (reuse Accelo tz helpers + current-week logic from `time-list.ts`)
  3. `fetchWeekDoneTasks(...)` → normalized tasks
  4. `loadMapping()`; for each task `resolve(project)`. Unmapped → `unmapped[]` (collected, not logged). Zero-duration → `skippedZero[]`.
  5. build Accelo entries `{ objectId, objectType, projectLabel, topic, description, time(seconds→"Xs"/seconds), billable, workTypeId }`; group by completion day (user tz).
  6. **dedup:** `fetchMyWorkLogs` for the range; skip entries whose subject+day already exist → `skippedDuplicates[]`.
  7. for each day → `logDay(..., { confirm })` (preview or log).
  8. return structured result: per-day previews/logged entries, totals, plus `unmapped`, `skippedZero`, `skippedDuplicates`.

### Registration — `src/tools/register.ts`

Add `buildBlitzitSyncTool(client, config)` to the collected tools.

### Config artifact

- `config/blitzit-accelo-map.example.json` seeded with the 18 known project names (AlligatorTPMS, Elite Dental Alliance, Houston Eye, Elite Enterprise, CMHoF, Velocity1, ConsiderItDone, OptimizedIT, AgentDealer, Cadco, Brownland Farm, Datamax, RJYoung, CAIA Connect, Provisions Group, InsideARM, Elite Dental Enterprise, Internal) with placeholder `objectId`s to fill in.
- README note documenting the tool, the map file, and the desktop-app-token requirement.

## Data flow

```
Blitzit desktop app IndexedDB → refresh token → ID token (Firebase)
  → Firestore runQuery (tasks: owner=uid, board=done) → filter week by endTime
  → normalize (project/topic/detail/seconds/day)
  → mapping table → Accelo {objectId,objectType,billable,workType}
  → group by day → dedup vs Accelo work logs
  → logDay() preview | createWorkLogNote mutations
```

## Error handling

- Blitzit app/token not found → actionable error (sign into desktop app).
- Firestore/securetoken HTTP errors → surfaced with status.
- Accelo session expired → existing `SESSION_EXPIRED` handling.
- Unmapped projects / zero-duration / duplicates → reported in result, never block other entries.
- Nothing is logged unless `confirm:true`.

## Testing (vitest)

- HTML parsing: `<strong>topic</strong><br>detail` → `{topic, detail}`; entity decode; missing `<strong>`.
- `timeTaken` ms → seconds rounding; zero-duration handling.
- Week range math (Mon–Sun in tz; `from`/`to` overrides).
- Mapping resolve: hit, miss (unmapped), with/without billable/workTypeId.
- Dedup: subject+day match skips; non-match logs.
- Unmapped/zero/duplicate reporting shape.
- Firestore and Accelo client calls mocked; no network in tests.

## Out of scope

- Writing back to Blitzit (one-way sync).
- Auto-creating Accelo objects for unmapped projects.
- Scheduling/automation (manual tool invocation only).
- Reading time from Blitzit `reports`/`sessions` (we use `timeTaken`).
