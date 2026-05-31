// Minimal stdio MCP client: handshake, list tools, optionally call one.
// Usage: node scripts/smoke.mjs [toolName] [jsonArgs]
import { spawn } from "node:child_process";

const [, , toolName, argsJson] = process.argv;
const child = spawn("node", ["dist/index.js"], { stdio: ["pipe", "pipe", "inherit"] });

let buf = "";
const pending = new Map();
child.stdout.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  }
});

let id = 0;
function rpc(method, params) {
  return new Promise((resolve) => {
    const reqId = ++id;
    pending.set(reqId, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: reqId, method, params }) + "\n");
  });
}
function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

const init = await rpc("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "smoke", version: "0" },
});
console.log("initialize → server:", init.result?.serverInfo);
notify("notifications/initialized", {});

const tools = await rpc("tools/list", {});
console.log("tools:", tools.result.tools.map((t) => t.name).join(", "));

if (toolName) {
  const args = argsJson ? JSON.parse(argsJson) : {};
  const res = await rpc("tools/call", { name: toolName, arguments: args });
  const text = res.result?.content?.map((c) => c.text).join("\n");
  console.log(`\n[${toolName}] isError=${res.result?.isError ?? false}`);
  console.log("text:\n" + text);
  console.log("structuredContent keys:", Object.keys(res.result?.structuredContent ?? {}));
}

child.kill();
process.exit(0);
