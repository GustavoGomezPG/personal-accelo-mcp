# Accelo MCP — Time Logging Feature Design Spec

**Date:** 2026-06-15
**Status:** Approved (design); pending implementation plan
**Builds on:** [2026-06-15-accelo-mcp-design.md](./2026-06-15-accelo-mcp-design.md)

## Summary

Extend the (currently read-only) Accelo MCP with the ability to **log, list, edit, and
delete time entries** ("work logs") against tasks/tickets, preserving the user's existing
time-entry nomenclature `Project :: Topic :: Description`. Writes go through Accelo's
GraphQL **mutations** over the same session-cookie endpoint (mutations are confirmed
available — no OAuth app required).

## Confirmed schema facts (validated live against `provisionsgroup`)

- The endpoint exposes a `Mutation` type. Time is logged as a **work-log note**.
- **Create:** `createWorkLogNote(input: createWorkLogArgs!)`. `createWorkLogArgs` fields:
  - `workLogAgainstObject: workLogAgainstObjectArgs!` = `{ id: ID!, type: WorkLogAgainstObjectTypes! }`. Enum values include `task`, `ticket`, `project`, `milestone`, etc. (lowercase).
  - `workLogSubject: String!` — the entry title (our nomenclature).
  - `workLogBody: RichText!` — body text.
  - `workLogLoggedTime: Seconds!` — time in seconds.
  - `workLogIsBillable: Boolean!`.
  - `workLogDate: Epoch` — entry date (seconds).
  - `workLogClassId: ID` — work type (optional).
  - `workLogFileIDs: [Int!]`, `workLogTagNames: [String!]`, `workLogTemplateId: ID` — unused in v1.
- **Read:** the `notes` connection is automatically scoped to the current user. Filters:
  `ints` keys `NoteId/NoteProjectId/NoteRetainerId/NoteSaleId/NoteTicketId`; `epochs` key
  `NoteDate` with operators incl. `greaterThanOrEqual`, `lessThan`, `between`. `Note` fields:
  `id, subject, date (Epoch), creator (union; Staff), loggedWork { billableTime, nonbillableTime } (Seconds), againstObject (union; Task/Ticket/...)`.
- **Identity & timezone:** current staff via `acceloConfig { userConfig { currentUser { ... on Staff { id name { fullName } timezone } } } }`. `timezone` is an IANA name (live value: `America/Los_Angeles`). Used as the basis for the workday "8am".
- **Duration of an entry:** `note.date` (Epoch) is the entry's **start time**; its duration is `loggedWork.billableTime + loggedWork.nonbillableTime` (Seconds). So an entry's end = `date + billable + nonbillable`. There is no separate end-time field.
- **Enums via variables:** inline enum literals must be unquoted; passing enum values as JSON
  strings only works through GraphQL **variables** (the client already sends variables).
- **List args are list-typed:** `filters` is `[<root>FilterAndBlockInput!]!`; `sort` is
  `[<root>SortFieldInput!]` (pass arrays).

**To resolve in the implementation plan (step 1, via validation-probe + introspection):**
the exact argument shapes of `updateNoteLoggedTime`, `updateNoteSubject`, and `deleteWorkLog`.

## Scope (v1)

In scope: **batch** log time (one or many entries for a day, auto-sequenced with no overlap),
list my time, edit a time entry, delete a time entry. Local stdio. Out of scope: timers,
approvals/submission, work-type pickers, attachments, tags, multi-day batches in a single call.

## Non-overlap time sequencing

`createWorkLogNote` has no start/end fields — only `workLogDate` (a timestamp) and
`workLogLoggedTime` (duration). We encode the **start time** in `workLogDate`'s time-of-day and
lay entries back-to-back so they never overlap:

- A "workday start" anchor — default **08:00**, configurable — interpreted in the user's Accelo
  **timezone** (detected from `currentUser.timezone`, e.g. `America/Los_Angeles`; overridable).
- For a given `date`, compute the starting cursor:
  - Read the user's existing work-log entries for that day (notes in `[day 00:00, next-day 00:00)`
    of the tz, filtered to the current staff id).
  - If none exist → `cursor = date @ 08:00` (workday start, in tz).
  - If some exist → `cursor = max(date @ 08:00, latest existing end)` where an entry's end is
    `note.date + billable + nonbillable`. (Mixed rule: empty day starts at 8am; otherwise resume
    after what's already there so a later batch never overlaps an earlier one.)
- Then for each entry in the **given order**: `workLogDate = cursor`; `cursor += duration`.

Example: empty day, entries `[2h, 1h, 30m]` → starts at 08:00, 10:00, 11:00.

## Write-safety model

The central read-only guard (`assertReadOnly`) **stays in place**. `client.query()` keeps
calling it, so `accelo_graphql` and all read tools remain read-only and reject mutations.

A new `client.mutate(mutation, variables)` method is added that **intentionally skips** the
guard. It is the **only** mutation path and is used **only** by the four curated write tools.
Net effect: exactly four named write operations are possible; arbitrary mutations remain
impossible (including via the raw `accelo_graphql` tool).

All write tools are **preview-first**: they accept a `confirm` boolean defaulting to `false`.
With `confirm: false` they return a preview of exactly what would change and do not call
`mutate`. With `confirm: true` they execute. `accelo_delete_time` requires `confirm: true`
and has no preview-less execution path.

## Components

| Unit | Responsibility |
|---|---|
| `src/config.ts` (modify) | Add optional `workdayStartHour` (default 8) and `workdayTz` (override; default = user's Accelo tz). |
| `src/accelo/client.ts` (modify) | Add `mutate()` (no guard) alongside guarded `query()`. |
| `src/accelo/time.ts` (new) | Parse human time (`"2h"`, `"45m"`, `"1:30"`, `"1.5h"`) → seconds; format seconds → `h:mm`. |
| `src/accelo/dates.ts` (new) | UTC date helpers: ymd↔epoch, current week range. |
| `src/accelo/tz.ts` (new) | Timezone-aware: `zonedDateTimeToEpoch(ymd, hour, min, tz)` and `dayRangeEpoch(ymd, tz)` for "8am in tz" and day boundaries. |
| `src/accelo/identity.ts` (new) | `getCurrentUser(client)` → `{ staffId, timezone }` via `acceloConfig.userConfig.currentUser`. |
| `src/accelo/worklogs.ts` (new) | `fetchMyWorkLogs(client, fromEpoch, toEpochExclusive)` — read the current user's work-log notes in a range (normalized `{id, startEpoch, subject, billable, nonbillable, against}`). Shared by log (cursor) and list. |
| `src/accelo/nomenclature.ts` (new) | `buildSubject(projectLabel, topic, description)`. |
| `src/tools/time-log.ts` (new) | `accelo_log_time` **batch** tool (sequence start times, create work logs). |
| `src/tools/time-list.ts` (new) | `accelo_list_my_time` tool (uses `fetchMyWorkLogs`). |
| `src/tools/time-edit.ts` (new) | `accelo_edit_time` tool (update logged time and/or subject). |
| `src/tools/time-delete.ts` (new) | `accelo_delete_time` tool (delete work log). |
| `src/tools/register.ts` (modify) | Register the four new tools. |

Reuses existing `ToolDescriptor`, `AcceloError`.

## Tools

### `accelo_log_time` (write, batch, preview-first)
Logs one **or many** entries for a single day, sequenced from the workday start with no overlap.

Inputs:
- `date: string` (`YYYY-MM-DD`, default today in the user's tz) — all entries belong to this day.
- `entries: Array<{ objectId: number, objectType?: enum (default "task"), projectLabel: string,
  topic: string, description: string, time: string, billable?: boolean (default true),
  workTypeId?: number }>` — **ordered**; start times follow this order. (A single entry = a list of one.)
- `confirm: boolean` (default `false`).

Behavior:
1. Validate each entry (parse `time` → seconds > 0; build `subject = projectLabel :: topic :: description`).
2. Resolve current user `{ staffId, timezone }`; pick tz = `workdayTz` override or user tz.
3. Compute the start cursor for `date`: `workdayStart = date @ workdayStartHour (tz)`; read the
   user's existing entries that day via `fetchMyWorkLogs`; `cursor = max(workdayStart, latest existing end)`.
4. Assign each entry in order: `workLogDate = cursor`; `cursor += seconds`.
5. Preview (`confirm:false`): return the full schedule
   `[{ subject, against:{id,type}, start:"HH:mm", end:"HH:mm", loggedTime:"h:mm", billable }]`,
   the resolved `date`/`tz`, whether it resumed after existing entries, and a note to set `confirm:true`.
   No `mutate` calls.
6. Commit (`confirm:true`): call `createWorkLogNote` once per entry (in order) with
   `workLogDate` = its start epoch; return the created note ids alongside the schedule.

`workLogBody` = the entry's `description`. Display times (`start`/`end`) are formatted in the tz.

### `accelo_list_my_time` (read)
Inputs: `from: string` / `to: string` (`YYYY-MM-DD`; default current week Mon–Sun),
`first: number` (default 50, max 100). Uses `fetchMyWorkLogs` over `[from 00:00, (to+1d) 00:00)`
(UTC boundaries for the list range). Returns items `{ id, date (YYYY-MM-DD), subject,
billable: "h:mm", nonbillable: "h:mm", against: {type, id, title} }`, plus `totalBillable`.
Defensively filters to the current staff id (the connection is already user-scoped).

### `accelo_edit_time` (write, preview-first)
Inputs: `noteId: number`, optional `time: string` (→ new logged seconds), optional new
nomenclature parts `projectLabel`/`topic`/`description` (all three required together to rebuild
the subject) **or** `subject: string` verbatim, `confirm: boolean` (default `false`). Preview
shows current vs proposed. On confirm, calls `updateNoteLoggedTime` and/or `updateNoteSubject`.
(Exact mutation arg shapes resolved in plan step 1.)

### `accelo_delete_time` (write, destructive)
Inputs: `noteId: number`, `confirm: boolean` (**required `true`**). Without `confirm: true`,
returns the entry that would be deleted and refuses. With it, calls `deleteWorkLog`.
(Exact arg shape resolved in plan step 1.)

## Error handling

Reuses `AcceloError` mapping (SESSION_EXPIRED / GRAPHQL_ERROR / HTTP_ERROR). Additional
validation errors surfaced as clear messages: unparseable `time`, non-positive duration,
invalid `date`, missing required nomenclature parts, edit with no changes specified.

## Testing (TDD)

Mocked-client unit tests:
- `time.ts`: parse `"2h"`/`"45m"`/`"1:30"`/`"1.5h"`/`"90m"` → seconds; reject garbage and `0`;
  format seconds → `h:mm`.
- `tz.ts`: `zonedDateTimeToEpoch("2026-06-08", 8, 0, "America/Los_Angeles")` = 08:00 PDT
  (verify against a known offset); `dayRangeEpoch` boundaries.
- `worklogs.ts`: builds `NoteDate` range filter; filters to current staff id; normalizes
  `{ startEpoch, billable, nonbillable }`; computes entry end.
- `log_time` (batch sequencing): empty day → entries start at 08:00 then back-to-back
  (`[2h,1h]` → 08:00, 10:00); non-empty day → cursor resumes at `max(8am, latest existing end)`;
  preview returns the schedule and calls `mutate` zero times; confirm calls `mutate` once per
  entry with `workLogDate` = each computed start epoch and `{id, type:"task"}`; invalid duration
  in any entry aborts the whole batch before any `mutate`.
- `list_my_time`: default week range; uses `fetchMyWorkLogs`; output mapped and summed.
- `edit_time` / `delete_time`: preview vs confirm gating; correct mutation variables; delete
  refuses without `confirm: true`.
- guard: `client.query()` still rejects a mutation; `client.mutate()` sends it (mocked fetch).

A manual live smoke test (real cookie) batch-logs two entries for an empty test day (verify
08:00 + back-to-back), lists them, edits one, deletes both — run by the user, not in CI.

## Configuration (additions)
- `ACCELO_WORKDAY_START_HOUR` (optional, default `8`) — workday start hour for sequencing.
- `ACCELO_WORKDAY_TZ` (optional) — IANA tz override; default is the current user's Accelo tz.

## File structure (additions)
```
src/accelo/time.ts · dates.ts · tz.ts · identity.ts · worklogs.ts · nomenclature.ts   (+ client.ts, config.ts modified)
src/tools/time-log.ts · time-list.ts · time-edit.ts · time-delete.ts · util.ts        (+ register.ts modified)
tests alongside each new module
```
