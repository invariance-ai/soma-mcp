import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerTools } from "../src/tools/index.js";

/**
 * Drive the REAL MCP server in-process via a linked transport pair, with a
 * mocked backend (global fetch). Verifies tool registration, that handlers
 * return both text + structuredContent, and that backend errors surface as
 * isError tool results rather than crashing.
 */

const ACTIVITY = {
  personId: "person:github:andy",
  label: "andy@acme.com",
  aliases: ["person:github:andy", "person:andy@acme.com"],
  counts: { pr: 1, commit: 0, issue: 0, review: 0, message: 0, incident: 0, meeting: 0, agent_run: 0, other: 0 },
  total: 1,
  firstSeenAt: "2026-05-30T10:00:00.000Z",
  lastSeenAt: "2026-05-30T10:00:00.000Z",
  timeline: [
    { receiptId: "r1", source: "github", kind: "github.pull_request", activity: "pr", title: "Fix checkout", url: null, occurredAt: "2026-05-30T10:00:00.000Z", businessObject: "acme/api" },
  ],
};

function mockBackend(routes: (path: string) => { status: number; body: unknown }) {
  vi.stubGlobal("fetch", async (url: URL | string) => {
    const path = new URL(url.toString()).pathname;
    const { status, body } = routes(path);
    return { ok: status < 300, status, json: async () => body } as Response;
  });
}

async function connect(): Promise<Client> {
  const server = new McpServer({ name: "soma-mcp-test", version: "0" });
  registerTools(server);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([client.connect(clientT), server.connect(serverT)]);
  return client;
}

beforeEach(() => {
  process.env.SOMA_BACKEND_URL = "http://localhost:8787";
  process.env.SOMA_ADMIN_TOKEN = "tok";
  process.env.SOMA_WORKSPACE_ID = "ws_test";
});
afterEach(() => vi.unstubAllGlobals());

describe("soma-mcp tools", () => {
  it("registers all eleven tools", async () => {
    mockBackend(() => ({ status: 200, body: {} }));
    const client = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "soma_ask",
      "soma_code_graph",
      "soma_connectors",
      "soma_dashboards",
      "soma_findings",
      "soma_log_streams",
      "soma_logs",
      "soma_people",
      "soma_person_activity",
      "soma_receipts",
      "soma_tickets",
    ]);
  });

  it("soma_person_activity returns text + structuredContent", async () => {
    mockBackend((p) => (p === "/v1/people/activity" ? { status: 200, body: { activity: ACTIVITY } } : { status: 200, body: {} }));
    const client = await connect();
    const res = (await client.callTool({ name: "soma_person_activity", arguments: { person: "andy" } })) as {
      content: { type: string; text: string }[];
      structuredContent?: { activity: unknown };
      isError?: boolean;
    };
    expect(res.isError).toBeFalsy();
    expect(res.content[0]!.text).toContain("andy@acme.com");
    expect(res.content[0]!.text).toContain("Fix checkout");
    expect(res.structuredContent?.activity).toEqual(ACTIVITY);
  });

  it("soma_person_activity handles a missing person (backend 404 → null activity, not error)", async () => {
    mockBackend(() => ({ status: 404, body: { error: { message: "none" } } }));
    const client = await connect();
    const res = (await client.callTool({ name: "soma_person_activity", arguments: { person: "ghost" } })) as {
      content: { text: string }[];
      structuredContent?: { activity: unknown };
      isError?: boolean;
    };
    expect(res.isError).toBeFalsy();
    expect(res.content[0]!.text).toMatch(/no recent activity/i);
    expect(res.structuredContent?.activity).toBeNull();
  });

  it("soma_findings returns the findings envelope", async () => {
    mockBackend(() => ({ status: 200, body: { findings: [{ id: "f1", title: "X", severity: "high", status: "open", event_count: 3, sources: ["sentry"], summary: "", last_seen_at: null, matched_ticket: null }] } }));
    const client = await connect();
    const res = (await client.callTool({ name: "soma_findings", arguments: {} })) as {
      structuredContent?: { findings: unknown[] };
    };
    expect(res.structuredContent?.findings).toHaveLength(1);
  });

  it("soma_logs returns text + structuredContent", async () => {
    mockBackend((p) =>
      p === "/v1/logs"
        ? {
            status: 200,
            body: {
              logs: [
                {
                  id: "log_1",
                  stream: "logs",
                  level: "error",
                  service: "checkout",
                  env: "prod",
                  message: "checkout timeout",
                  occurred_at: "2026-06-01T00:00:00.000Z",
                },
              ],
            },
          }
        : { status: 200, body: {} },
    );
    const client = await connect();
    const res = (await client.callTool({ name: "soma_logs", arguments: { level: "error" } })) as {
      content: { text: string }[];
      structuredContent?: { logs: unknown[] };
    };
    expect(res.content[0]!.text).toContain("checkout timeout");
    expect(res.structuredContent?.logs).toHaveLength(1);
  });

  it("soma_log_streams returns stream summaries", async () => {
    mockBackend((p) =>
      p === "/v1/logs/streams"
        ? { status: 200, body: { streams: [{ name: "logs", count: 10, errorCount: 2 }] } }
        : { status: 200, body: {} },
    );
    const client = await connect();
    const res = (await client.callTool({ name: "soma_log_streams", arguments: {} })) as {
      content: { text: string }[];
      structuredContent?: { streams: unknown[] };
    };
    expect(res.content[0]!.text).toContain("logs");
    expect(res.structuredContent?.streams).toHaveLength(1);
  });

  it("soma_dashboards returns saved dashboards", async () => {
    mockBackend((p) =>
      p === "/v1/dashboards"
        ? { status: 200, body: { dashboards: [{ id: "dash_1", name: "Ops", slug: "ops", tiles: [] }] } }
        : { status: 200, body: {} },
    );
    const client = await connect();
    const res = (await client.callTool({ name: "soma_dashboards", arguments: {} })) as {
      content: { text: string }[];
      structuredContent?: { dashboards: unknown[] };
    };
    expect(res.content[0]!.text).toContain("Ops");
    expect(res.structuredContent?.dashboards).toHaveLength(1);
  });

  it("surfaces backend errors as isError tool results", async () => {
    mockBackend(() => ({ status: 400, body: { error: { message: "bad" } } }));
    const client = await connect();
    const res = (await client.callTool({ name: "soma_findings", arguments: {} })) as {
      content: { text: string }[];
      isError?: boolean;
    };
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain("Soma platform error");
  });

  it("soma_ask returns a helpful message when no person is in the question (no model call)", async () => {
    mockBackend(() => ({ status: 200, body: {} }));
    const client = await connect();
    const res = (await client.callTool({ name: "soma_ask", arguments: { question: "list all findings" } })) as {
      content: { text: string }[];
      structuredContent?: { person: string | null };
    };
    expect(res.content[0]!.text).toMatch(/couldn't identify a person/i);
    expect(res.structuredContent?.person).toBeNull();
  });
});
