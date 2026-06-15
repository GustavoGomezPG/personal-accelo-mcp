# Accelo MCP — Design Spec

**Date:** 2026-06-15
**Status:** Approved (design); pending implementation plan

## Summary

A local Model Context Protocol (MCP) server that gives an LLM read-only access to
an Accelo deployment's data (companies, contacts, projects, tasks, tickets) by
reusing the logged-in user's **session** against Accelo's internal **GraphQL**
endpoint — no OAuth application required.

## Access method (verified)

Accelo's public REST API (`{deployment}.api.accelo.com/api/v0/...`) requires an
OAuth bearer token and a registered app, and is CORS-blocked in the browser. We
avoid it. Instead we use the deployment's internal GraphQL endpoint, which
authenticates with the session cookie alone:

- `POST https://${deployment}.accelo.com/graphql` (main origin)
- Header `Cookie: AFFINITYLIVE=<session value>`
- Header `X-CSRF-REQUESTED: 1` (required)
- `Content-Type: application/json`, body `{ "query": "..." }`

Verified live against `provisionsgroup`: returns `200` with data and supports
full introspection. The GraphQL `Query` type exposes 64 root fields covering the
whole domain (companies, contacts, projects, tasks, tickets, milestones, sales,
invoices, quotes, retainers, timesheets, timers, staff, globalSearch, etc.).

**Caveats:**
- `AFFINITYLIVE` is HttpOnly, so it cannot be read via `document.cookie`. The user
  copies its value from DevTools → Application → Cookies.
- It is a session cookie and will expire; the value must be re-copied periodically.
  The durable alternative (OAuth "Service Application", admin-registered) is out of
  scope for this version by user choice.

## Scope (v1)

- **Read-only.** No mutations exposed; outbound operations are guarded.
- **Entities:** Companies & Contacts, Projects & Tasks, Tickets.
- **Transport:** local stdio.
- **Config:** `.env` file.

Out of scope for v1: writes/mutations, Sales/Invoices/Retainers entities, HTTP
transport, automatic cookie extraction, OAuth.

## Architecture

- TypeScript on Node 25, `@modelcontextprotocol/sdk`, `zod` for tool input
  schemas, built-in `fetch`. Tests with `vitest`.
- A single thin GraphQL **client** wraps all network calls (URL building, headers,
  read-only guard, error mapping). Tools are small modules that build a query and
  shape the response. This keeps each unit independently testable.

### Components

| Unit | Responsibility | Depends on |
|---|---|---|
| `config.ts` | Load + validate `ACCELO_DEPLOYMENT`, `ACCELO_SESSION_COOKIE`; build endpoint URL | env |
| `accelo/client.ts` | Execute GraphQL queries with cookie + CSRF headers; enforce read-only; map errors | config, fetch |
| `accelo/queries.ts` | GraphQL query strings + the curated field sets per entity | — |
| `tools/*.ts` | One module per entity group + raw + introspect; define zod input schemas, call client, shape output | client, queries |
| `tools/index.ts` | Register all tools on the MCP server | tools/* |
| `index.ts` | Bootstrap server over stdio | config, tools |

## Auth & configuration

`.env` (gitignored), documented in `.env.example`:

```
ACCELO_DEPLOYMENT=provisionsgroup
ACCELO_SESSION_COOKIE=<AFFINITYLIVE value from DevTools>
```

Client builds `https://${ACCELO_DEPLOYMENT}.accelo.com/graphql` and sends headers
`Cookie: AFFINITYLIVE=${ACCELO_SESSION_COOKIE}`, `X-CSRF-REQUESTED: 1`,
`Content-Type: application/json`. On startup, missing/empty vars fail fast with a
clear message.

## Tools (read-only)

### Curated (10)

Each search tool accepts pagination (`first`, default 20, max 100; `after` cursor)
and returns `{ items: [...], totalCount, endCursor, hasNextPage }`. Each get tool
accepts an `id`. Field sets below are the v1 defaults (nested object types are
sub-selected to useful scalars, e.g. `status { id title }`, `company { id name }`,
`assignee`/`manager`/`accountManagers` to staff name + id).

| Tool | Key fields returned |
|---|---|
| `accelo_search_companies` / `accelo_get_company` | id, name, status, phoneNumber, website, accountManagers, activeProjectCount, activeTicketCount, primaryAddress, createdDate, lastModifiedDate |
| `accelo_search_contacts` / `accelo_get_contact` | id, name, status, primaryAffiliatedCompany, addresses, lastContactDate |
| `accelo_search_projects` / `accelo_get_project` | id, title, company, manager, status, standing, budget, commencedDate, completedDate, createdDate |
| `accelo_search_tickets` / `accelo_get_ticket` | id, title, company, assignee, status, priority, openedDate, dueDate, resolution, resolutionNotes |
| `accelo_search_tasks` / `accelo_get_task` | id, title, assignee, status, project, ticket, milestone, scheduledStartDate, scheduledDueDate, totalLoggedTime, totalBudgetedTime |

Search filtering and sorting use the GraphQL `filters`/`sort` args on the Relay
connections (the API uses a `filterCacheID`-based filter system). The exact filter
input shape and the get-by-id mechanism (singular field vs. id filter on the
connection) require additional schema introspection and will be resolved in the
implementation plan before coding. `globalSearch` may back a future cross-entity
search tool but is out of scope for v1.

### Escape hatches (2)

- `accelo_graphql` — run an arbitrary **query**. Read-only enforced (see Safety).
- `accelo_introspect` — return types/fields for a named type (or root query fields)
  so the model can extend a query when a curated field is missing.

## Read-only safety

The client parses every outbound operation and rejects anything that is not a
`query` operation (no `mutation`, no `subscription`). The guard runs centrally in
`accelo/client.ts`, so even the raw `accelo_graphql` tool cannot mutate. No tool
exposes a write path. Parsing uses the `graphql` package's `parse` to inspect
`OperationDefinition.operation`; anonymous shorthand `{ ... }` is treated as a
query.

## Error handling

- Network/non-200 responses → structured error with status.
- Login redirect / HTML response / 401 / 403 (expired or invalid cookie) → a
  specific actionable message: "Accelo session cookie expired or invalid — refresh
  the AFFINITYLIVE value in .env from DevTools."
- GraphQL `errors` array present → surfaced to the caller (not swallowed),
  including the first error message and path.

## Testing (TDD)

Unit tests with a mocked `fetch`:
- Read-only guard rejects a `mutation` and a `subscription`; accepts a `query` and
  shorthand `{ ... }`.
- Request shaping: correct URL from deployment, `Cookie` and `X-CSRF-REQUESTED`
  headers set, JSON body.
- Error mapping: expired-session detection (HTML/redirect/401/403) yields the
  actionable message; GraphQL `errors` surfaced.
- Tool output shaping: a sample connection response maps to
  `{ items, totalCount, endCursor, hasNextPage }`.

Optional live smoke test hitting the real endpoint, skipped when no real cookie is
configured (so CI stays green).

## Project structure

```
src/
  index.ts            server bootstrap (stdio)
  config.ts           env loading + validation
  accelo/
    client.ts         GraphQL fetch (cookie + CSRF), read-only guard, error mapping
    queries.ts        query strings + curated field sets
  tools/
    companies.ts contacts.ts projects.ts tickets.ts tasks.ts
    raw.ts introspect.ts index.ts
tests/
.env.example
README.md
```
