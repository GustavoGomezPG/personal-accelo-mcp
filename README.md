# Accelo MCP

A local, read-only [MCP](https://modelcontextprotocol.io) server for Accelo. It
reuses your logged-in browser **session** against Accelo's internal GraphQL
endpoint, so no OAuth application is required.

## Setup

1. `npm install && npm run build`
2. Copy `.env.example` to `.env` and fill in:
   - `ACCELO_DEPLOYMENT` — your subdomain (e.g. `yourcompany` for `yourcompany.accelo.com`).
   - `ACCELO_SESSION_COOKIE` — the `AFFINITYLIVE` cookie value:
     Chrome DevTools → Application → Cookies → `https://<deployment>.accelo.com`
     → `AFFINITYLIVE` → copy **Value**.

   The cookie is a session token and **expires**; when tools start returning
   `SESSION_EXPIRED`, copy a fresh value.

## Connect to Claude Code / Claude Desktop

Add to your MCP client config:

```json
{
  "mcpServers": {
    "accelo": {
      "command": "node",
      "args": ["/absolute/path/to/accelo-mcp/dist/index.js"],
      "env": {
        "ACCELO_DEPLOYMENT": "<your-deployment>",
        "ACCELO_SESSION_COOKIE": "<AFFINITYLIVE value>"
      }
    }
  }
}
```

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
