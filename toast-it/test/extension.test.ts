import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import extension from "../index.ts";

function register() {
  const tools: ToolDefinition[] = [];
  extension({ registerTool(tool: ToolDefinition) { tools.push(tool); } } as ExtensionAPI);
  return tools;
}

test("factory registers fixed tools offline, never reads configuration or starts background work", () => {
  const previous = process.env.TOAST_IT_HTTP_URL;
  process.env.TOAST_IT_HTTP_URL = "invalid startup config";
  try {
    const tools = register();
    assert.deepEqual(tools.map(tool => tool.name), ["toastit_tools", "toastit_call", "toastit_approval", "toastit_health"]);
    const call = tools[1];
    const schema = call.parameters as unknown as { additionalProperties: boolean; properties: Record<string, { type: string; additionalProperties?: boolean }> };
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(Object.keys(schema.properties), ["name", "arguments"]);
    assert.equal(schema.properties.arguments.type, "object");
    assert.equal(schema.properties.arguments.additionalProperties, true);
    assert.match(call.description, /202.*NOT execution success/);
    assert.match(tools[0].description, /complete inputSchema/);
    assert.match(tools[2].description, /cannot approve/);
  } finally {
    if (previous === undefined) delete process.env.TOAST_IT_HTTP_URL;
    else process.env.TOAST_IT_HTTP_URL = previous;
  }
});

test("registered execution forwards only arguments, renders safely, and throws Pi errors", async t => {
  const secret = "c".repeat(43);
  const id = "12345678-abcd-1234-abcd-123456789012";
  const root = await mkdtemp(join(tmpdir(), "pi-toastit-registration-"));
  await writeFile(join(root, "http-api.token"), secret, { mode: 0o600 });
  const seen: Array<{ path: string; body: unknown }> = [];
  let failure = false;
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    seen.push({ path: req.url!, body: body ? JSON.parse(body) : null });
    assert.equal(req.headers.authorization, `Bearer ${secret}`);
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/v1/tools") {
      res.end(JSON.stringify({ apiVersion: "v1", tools: [{ name: "note.delete", description: "Delete", inputSchema: { type: "object" } }] }));
    } else if (req.method === "POST") {
      res.statusCode = failure ? 500 : 202;
      res.end(JSON.stringify(failure ? { ok: false, error: { code: "failed", message: secret } } : { ok: true, status: "approval_required", approvalId: id }));
    } else res.end(JSON.stringify({ apiVersion: "v1", status: "ready" }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const previous = { ...process.env };
  process.env.TOAST_IT_HTTP_URL = `http://127.0.0.1:${address.port}/api/v1`;
  process.env.TOAST_IT_CONFIG_ROOT = root;
  delete process.env.TOAST_IT_TIMEOUT_MS;
  delete process.env.TOAST_IT_OUTPUT_BYTES;
  t.after(async () => {
    for (const key of ["TOAST_IT_HTTP_URL", "TOAST_IT_CONFIG_ROOT", "TOAST_IT_TIMEOUT_MS", "TOAST_IT_OUTPUT_BYTES"]) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  });
  const tools = register();
  const call = tools.find(tool => tool.name === "toastit_call")!;
  const ctx = {} as Parameters<typeof call.execute>[4];
  const result = await call.execute("id", { name: "note.delete", arguments: { uuid: id }, origin: "ignored", headers: { Authorization: secret } }, undefined, undefined, ctx);
  assert.deepEqual(seen[1].body, { arguments: { uuid: id } });
  assert.match(result.content[0].type === "text" ? result.content[0].text : "", /Not executed/);
  assert(!JSON.stringify(result).includes(secret));
  // Render only static call text and already-sanitized bounded result content.
  const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text } as Parameters<NonNullable<typeof call.renderCall>>[1];
  const renderContext = { isError: false } as Parameters<NonNullable<typeof call.renderCall>>[2];
  assert(!call.renderCall!({ arguments: { secret } }, theme, renderContext).render(80).join("\n").includes(secret));
  const resultContext = renderContext as Parameters<NonNullable<typeof call.renderResult>>[3];
  for (const expanded of [false, true]) {
    const rendered = call.renderResult!(result, { expanded, isPartial: false }, theme, resultContext).render(80).join("\n");
    assert.match(rendered, /Not\s+executed/);
    assert(!rendered.includes(secret));
  }
  failure = true;
  await assert.rejects(call.execute("id2", { name: "note.delete", arguments: {} }, undefined, undefined, ctx), error => error instanceof Error && /HTTP 500/.test(error.message) && !error.message.includes(secret));
});
