/**
 * Tool registrations for the Soma MCP server. One tool per dashboard data
 * surface plus the people-activity and NL "what is X doing?" tools. Every tool
 * returns BOTH a human-readable text summary (via the shared formatter, so it
 * matches the CLI exactly) and structuredContent (the typed JSON), so agent
 * clients can consume either.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  answerPersonQuestion,
  extractPersonQuery,
  formatCodeGraph,
  formatConnectors,
  formatDashboards,
  formatFindings,
  formatLogs,
  formatLogStreams,
  formatPeople,
  formatPersonActivity,
  formatReceipts,
  formatTickets,
  PlatformError,
} from "@invariance/soma-cli/agent-core";
import { client } from "../client.js";

type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function text(s: string): { type: "text"; text: string }[] {
  return [{ type: "text", text: s }];
}

/** Wrap a handler so backend failures become clean MCP tool errors, not crashes. */
function guard<A>(fn: (args: A) => Promise<ToolResult>): (args: A) => Promise<ToolResult> {
  return async (args: A) => {
    try {
      return await fn(args);
    } catch (err) {
      const msg = err instanceof PlatformError ? err.message : err instanceof Error ? err.message : String(err);
      return { content: text(`Soma platform error: ${msg}`), isError: true };
    }
  };
}

export function registerTools(server: McpServer): void {
  server.registerTool(
    "soma_findings",
    {
      title: "List findings",
      description: "List assembled findings (error clusters with evidence, severity, correlated deploy).",
      inputSchema: {},
      outputSchema: { findings: z.array(z.any()) },
    },
    guard(async () => {
      const findings = await client().listFindings();
      return { content: text(formatFindings(findings)), structuredContent: { findings } };
    }),
  );

  server.registerTool(
    "soma_tickets",
    {
      title: "List tickets",
      description: "List tickets across Linear/GitHub, each linked to its error signature.",
      inputSchema: {},
      outputSchema: { tickets: z.array(z.any()) },
    },
    guard(async () => {
      const tickets = await client().listTickets();
      return { content: text(formatTickets(tickets)), structuredContent: { tickets } };
    }),
  );

  server.registerTool(
    "soma_connectors",
    {
      title: "Connector status",
      description: "Ingestion status per connector (live/error/verified, last event, volume). Pass `source` for one.",
      inputSchema: { source: z.string().optional().describe("a single connector source, e.g. 'github'") },
      outputSchema: { connectors: z.array(z.any()) },
    },
    guard(async ({ source }: { source?: string }) => {
      const connectors = source ? [await client().getConnector(source)] : await client().listConnectors();
      return { content: text(formatConnectors(connectors)), structuredContent: { connectors } };
    }),
  );

  server.registerTool(
    "soma_receipts",
    {
      title: "Query raw receipts",
      description: "Query the raw normalized event log (receipts) with optional source/kind/since/limit filters.",
      inputSchema: {
        source: z.string().optional(),
        kind: z.string().optional(),
        since: z.string().optional().describe("ISO timestamp; receipts on/after this"),
        limit: z.number().int().positive().optional(),
      },
      outputSchema: { receipts: z.array(z.any()) },
    },
    guard(async (args: { source?: string; kind?: string; since?: string; limit?: number }) => {
      const receipts = await client().listReceipts(args);
      return { content: text(formatReceipts(receipts)), structuredContent: { receipts } };
    }),
  );

  server.registerTool(
    "soma_logs",
    {
      title: "Query logs / telemetry",
      description:
        "Query logs, HTTP access logs, distributed traces, user sessions, and agent run traces " +
        "with optional stream/level/service/env/q/since/limit filters.",
      inputSchema: {
        stream: z.string().optional().describe("logs | access | trace | session | agent"),
        level: z.string().optional().describe("debug | info | warn | error"),
        service: z.string().optional(),
        env: z.string().optional().describe("prod | staging"),
        q: z.string().optional().describe("free-text search against the message"),
        since: z.string().optional().describe("ISO timestamp; logs on/after this"),
        limit: z.number().int().positive().optional(),
      },
      outputSchema: { logs: z.array(z.any()) },
    },
    guard(
      async (args: {
        stream?: string;
        level?: string;
        service?: string;
        env?: string;
        q?: string;
        since?: string;
        limit?: number;
      }) => {
        const logs = await client().listLogs(args);
        return { content: text(formatLogs(logs)), structuredContent: { logs } };
      },
    ),
  );

  server.registerTool(
    "soma_log_streams",
    {
      title: "Summarize log streams",
      description: "Per-stream event + error counts across logs, access, traces, sessions and agent runs.",
      inputSchema: {},
      outputSchema: { streams: z.array(z.any()) },
    },
    guard(async () => {
      const streams = await client().listLogStreams();
      return { content: text(formatLogStreams(streams)), structuredContent: { streams } };
    }),
  );

  server.registerTool(
    "soma_dashboards",
    {
      title: "List dashboards",
      description: "List saved Visualizations dashboards (name, slug, tile count) for the workspace.",
      inputSchema: {},
      outputSchema: { dashboards: z.array(z.any()) },
    },
    guard(async () => {
      const dashboards = await client().listDashboards();
      return { content: text(formatDashboards(dashboards)), structuredContent: { dashboards } };
    }),
  );

  server.registerTool(
    "soma_code_graph",
    {
      title: "Read code graph",
      description: "Read the code graph (nodes + edges) for the workspace, optionally filtered to one repo.",
      inputSchema: {
        repo: z.string().optional(),
        node_kind: z.string().optional().describe("filter nodes by kind (file|function|class|...)"),
      },
      outputSchema: { nodes: z.array(z.any()), edges: z.array(z.any()) },
    },
    guard(async ({ repo, node_kind }: { repo?: string; node_kind?: string }) => {
      const graph = await client().getCodeGraph({ repo, nodeKind: node_kind });
      return { content: text(formatCodeGraph(graph)), structuredContent: { nodes: graph.nodes, edges: graph.edges } };
    }),
  );

  server.registerTool(
    "soma_people",
    {
      title: "List people",
      description: "List people with recent activity (reconstructed from receipts), with per-kind counts.",
      inputSchema: { since: z.string().optional().describe("ISO timestamp; only count activity on/after this") },
      outputSchema: { people: z.array(z.any()) },
    },
    guard(async ({ since }: { since?: string }) => {
      const people = await client().listPeople(since);
      return { content: text(formatPeople(people)), structuredContent: { people } };
    }),
  );

  server.registerTool(
    "soma_person_activity",
    {
      title: "What is a person doing",
      description:
        "What a specific person is doing right now — recent PRs, commits, tickets, incidents, messages. " +
        "The deterministic answer to 'what is andy doing?'.",
      inputSchema: {
        person: z.string().describe("name, github login, email, or person:* id"),
        since: z.string().optional(),
        limit: z.number().int().positive().optional().describe("max timeline events"),
      },
      outputSchema: { activity: z.any().nullable() },
    },
    guard(async ({ person, since, limit }: { person: string; since?: string; limit?: number }) => {
      const activity = await client().getPersonActivity(person, { since, limit });
      const summary = activity
        ? formatPersonActivity(activity)
        : `No recent activity found for "${person}".`;
      return { content: text(summary), structuredContent: { activity } };
    }),
  );

  server.registerTool(
    "soma_ask",
    {
      title: "Ask Soma (natural language)",
      description:
        "Answer a natural-language question. Currently specialized for people questions " +
        "('what is andy doing?', 'who is bea?'): it pulls the person's activity and summarizes it.",
      inputSchema: {
        question: z.string(),
        model: z.string().optional().describe("model passed to the local claude CLI"),
      },
      outputSchema: {
        answer: z.string(),
        person: z.string().nullable(),
        source: z.string(),
        activity: z.any().nullable(),
      },
    },
    guard(async ({ question, model }: { question: string; model?: string }) => {
      const person = extractPersonQuery(question);
      if (!person) {
        const answer =
          "I couldn't identify a person in that question. This tool currently handles people " +
          "questions (e.g. 'what is andy doing?'). For findings/tickets/receipts/code, use the " +
          "soma_findings / soma_tickets / soma_receipts / soma_code_graph tools.";
        return {
          content: text(answer),
          structuredContent: { answer, person: null, source: "deterministic", activity: null },
        };
      }
      const result = await answerPersonQuestion(client(), question, person, { model });
      return {
        content: text(result.answer),
        structuredContent: {
          answer: result.answer,
          person: result.person,
          source: result.source,
          activity: result.activity,
        },
      };
    }),
  );
}
