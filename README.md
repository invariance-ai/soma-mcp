# soma-mcp

MCP server for Invariance Soma. Exposes the **same data the Soma dashboard shows** —
findings, tickets, connectors, raw receipts, the code graph, and people activity —
to coding agents (Claude Code, Codex, …) over the Model Context Protocol on stdio.

It reuses the platform client + formatters from `@invariance/soma-cli` so the CLI and
MCP never drift: a given query renders identically in `soma who andy` and the
`soma_person_activity` tool.

## Tools

| Tool | What it returns |
| --- | --- |
| `soma_findings` | Assembled findings (error clusters, evidence, severity, correlated deploy) |
| `soma_tickets` | Tickets across Linear/GitHub linked to error signatures |
| `soma_connectors` | Connector ingestion status (pass `source` for one) |
| `soma_receipts` | Raw normalized event log, filterable by source/kind/since/limit |
| `soma_code_graph` | Code graph nodes + edges (filter by `repo`) |
| `soma_people` | People with recent activity + per-kind counts |
| `soma_person_activity` | **"what is andy doing?"** — one person's recent PRs/commits/tickets/messages |
| `soma_ask` | Natural-language people questions; summarizes activity via the local `claude` CLI |

Every tool returns a human-readable text summary **and** `structuredContent` (typed JSON).

## Config (env)

Same admin-token contract the dashboard server uses:

- `SOMA_BACKEND_URL` — backend base URL (default `http://localhost:8787`)
- `SOMA_ADMIN_TOKEN` — admin token (dev fallback `dev-soma-admin-token-change-me`)
- `SOMA_WORKSPACE_ID` — workspace to read (dev fallback `ws_test`)

## Build & run

```bash
# soma-cli must be built and present as a sibling (`../soma-cli`) first:
cd ../soma-cli && npm install && npm run build
cd ../soma-mcp && npm install && npm run build
node dist/index.js   # speaks MCP over stdio
```

> **Dependency note:** `@invariance/soma-cli` is consumed via `file:../soma-cli`,
> assuming the standard sibling layout (`invariance-soma/soma-cli`,
> `invariance-soma/soma-mcp`). Build soma-cli before installing soma-mcp.

## Register with Claude Code

```json
{
  "mcpServers": {
    "soma": {
      "command": "node",
      "args": ["/abs/path/to/soma-mcp/dist/index.js"],
      "env": {
        "SOMA_BACKEND_URL": "http://localhost:8787",
        "SOMA_ADMIN_TOKEN": "…",
        "SOMA_WORKSPACE_ID": "ws_test"
      }
    }
  }
}
```
