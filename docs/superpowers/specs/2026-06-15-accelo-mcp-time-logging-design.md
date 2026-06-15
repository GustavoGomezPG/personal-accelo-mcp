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
- **Identity:** current staff via `acceloConfig { userConfig { currentUser { ... on Staff { id name { fullName } } } } }`.
- **Enums via variables:** inline enum literals must be unquoted; passing enum values as JSON
  strings only works through GraphQL **variables** (the client already sends variables).
- **List args are list-typed:** `filters` is `[<root>FilterAndBlockInput!]!`; `sort` is
  `[<root>SortFieldInput!]` (pass arrays).

**To resolve in the implementation plan (step 1, via validation-probe + introspection):**
the exact argument shapes of `updateNoteLoggedTime`, `updateNoteSubject`, and `deleteWorkLog`.

## Scope (v1)

In scope: log time, list my time, edit a time entry, delete a time entry. Local stdio,
`.env` config (unchanged). Out of scope: timers, approvals/submission, work-type pickers,
attachments, tags, bulk logging.

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
| `src/accelo/client.ts` (modify) | Add `mutate()` (no guard) alongside guarded `query()`. |
| `src/accelo/time.ts` (new) | Parse human time (`"2h"`, `"45m"`, `"1:30"`, `"1.5h"`) → seconds; format seconds → `h:mm`. |
| `src/accelo/identity.ts` (new) | `getCurrentStaffId(client)` via `acceloConfig.userConfig.currentUser`. |
| `src/tools/time-log.ts` (new) | `accelo_log_time` tool (build subject, create work log). |
| `src/tools/time-list.ts` (new) | `accelo_list_my_time` tool (read notes by date range). |
| `src/tools/time-edit.ts` (new) | `accelo_edit_time` tool (update logged time and/or subject). |
| `src/tools/time-delete.ts` (new) | `accelo_delete_time` tool (delete work log). |
| `src/tools/register.ts` (modify) | Register the four new tools. |

Reuses existing `ToolDescriptor`, `AcceloError`, `shapeConnection`.

## Tools

### `accelo_log_time` (write, preview-first)
Inputs: `taskId: number` (logs against a task; `objectType` optional, default `"task"`, enum
of WorkLogAgainstObjectTypes), `projectLabel: string` (**required** — intentional nomenclature,
e.g. `"OptimizedIT"`), `topic: string` (e.g. `"Website"`), `description: string`,
`time: string` (parsed to seconds; must be > 0), `billable: boolean` (default `true`),
`date: string` (`YYYY-MM-DD`, default today), `workTypeId: number` (optional → `workLogClassId`),
`confirm: boolean` (default `false`).

Behavior: builds `subject = "${projectLabel} :: ${topic} :: ${description}"`; `workLogBody`
= `description`. Preview returns `{ subject, against: {id, type, title}, loggedTime: "h:mm",
seconds, billable, date }` and a note that `confirm: true` will log it. On confirm, calls
`createWorkLogNote` via `mutate()`, returns the created note `{ id, subject }`.

### `accelo_list_my_time` (read)
Inputs: `from: string` / `to: string` (`YYYY-MM-DD`; default current week Mon–Sun),
`first: number` (default 50, max 100). Queries `notes` with `epochs` `NoteDate >=` from and
`< to+1day`, sorted by `NoteDate`. Returns items `{ id, date (YYYY-MM-DD), subject,
billable: "h:mm", nonbillable: "h:mm", against: {type, id, title} }`, plus a `totalLoggedTime`
sum. Defensively filters to the current staff id (the connection is already user-scoped).

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
- `log_time`: subject built as `A :: B :: C`; preview mode returns preview and calls neither
  `query` nor `mutate`; confirm mode calls `mutate` with the correct `createWorkLogArgs`
  variables (object `{id, type:"task"}`, seconds, billable, epoch date).
- `list_my_time`: default week range computed; notes variables shaped with `NoteDate` filters;
  output mapped and summed.
- `edit_time` / `delete_time`: preview vs confirm gating; correct mutation variables; delete
  refuses without `confirm: true`.
- guard: `client.query()` still rejects a mutation; `client.mutate()` sends it (mocked fetch).

A manual live smoke test (real cookie) logs a tiny entry, lists it, edits it, deletes it —
run by the user, not in CI.

## File structure (additions)
```
src/accelo/time.ts · identity.ts            (+ client.ts modified)
src/tools/time-log.ts · time-list.ts · time-edit.ts · time-delete.ts   (+ register.ts modified)
tests alongside each new module
```
