#!/usr/bin/env node
/**
 * Soma MCP server — exposes the same data the Soma dashboard shows (findings,
 * tickets, connectors, raw receipts, code graph, people activity) to coding
 * agents over the Model Context Protocol, on stdio.
 *
 * Config (env): SOMA_BACKEND_URL, SOMA_ADMIN_TOKEN, SOMA_WORKSPACE_ID — the
 * same admin-token contract the dashboard server uses.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools/index.js";

async function main(): Promise<void> {
  const server = new McpServer({ name: "soma-mcp", version: "0.1.0" });
  registerTools(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only — stdout is the MCP transport.
  process.stderr.write("soma-mcp: listening on stdio\n");
}

main().catch((err) => {
  process.stderr.write(`soma-mcp: fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
