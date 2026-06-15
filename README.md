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

Read-only. For each of **companies, contacts, projects, tickets, tasks**:
- `accelo_search_<entities>` — free-text search + id filters + sort + pagination.
- `accelo_get_<entity>` — fetch one by numeric id.

Escape hatches:
- `accelo_graphql` — run an arbitrary read-only GraphQL query.
- `accelo_introspect` — explore the schema (root fields, or a named type).

Mutations and subscriptions are always rejected.
