import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from "undici";
import { approval, callTool, discover, health, loadConfig, modelResult, type Config } from "../core.ts";

const TOKEN = "a".repeat(43);
const ID = "12345678-abcd-1234-abcd-123456789012";
const tools = ["note.get", "note.create", "note.delete", "sql.query", "assistant.schedule.runNow", "web_search", "web_fetch"].map(name => ({
  name, description: `Tool ${name}`, inputSchema: { type: "object", properties: { name: { type: "string" } }, additionalProperties: false },
  approvalRequired: name === "note.delete", scheduledPermissions: { READ_ONLY: true, STANDARD: true, FULL: true },
}));
const ready = { apiVersion: "v1", status: "ready", limits: { requestBytes: 65536 } };
function json(res: ServerResponse, body: unknown, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
interface Seen { path: string; method: string; body: string; headers: IncomingMessage["headers"] }
async function fixture(t: TestContext, handle?: (req: IncomingMessage, res: ServerResponse, seen: Seen) => void) {
  const root = await mkdtemp(join(tmpdir(), "pi-toastit-test-"));
  const tokenPath = join(root, "http-api.token");
  await writeFile(tokenPath, TOKEN, { mode: 0o600 });
  const seen: Seen[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const entry = { path: req.url!, method: req.method!, body, headers: req.headers };
    seen.push(entry);
    if (handle) handle(req, res, entry);
    else if (req.url === "/api/v1/tools") json(res, { apiVersion: "v1", tools });
    else if (req.url === "/api/v1/health") json(res, ready);
    else json(res, { ok: true, success: true, status: "success", data: { name: "Saved" } });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const config = loadConfig({ TOAST_IT_HTTP_URL: `http://127.0.0.1:${address.port}/api/v1`, TOAST_IT_CONFIG_ROOT: root });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  });
  return { config, root, tokenPath, seen, server };
}

test("configuration defaults, precedence, normalization and strict bounds", () => {
  assert.deepEqual(loadConfig({ HOME: "/home/example" }), {
    baseUrl: "http://127.0.0.1:47631/api/v1", tokenPath: "/home/example/.config/toast-it/http-api.token", timeoutMs: 20000, outputBytes: 24576,
  });
  assert.equal(loadConfig({ XDG_CONFIG_HOME: "/xdg" }).tokenPath, "/xdg/toast-it/http-api.token");
  const configured = loadConfig({ TOAST_IT_CONFIG_ROOT: "/override", XDG_CONFIG_HOME: "/xdg", TOAST_IT_HTTP_URL: "http://localhost:1234/api/v1/", TOAST_IT_TIMEOUT_MS: "60000", TOAST_IT_OUTPUT_BYTES: "51200" });
  assert.equal(configured.tokenPath, "/override/http-api.token");
  assert.equal(configured.baseUrl, "http://127.0.0.1:1234/api/v1");
  for (const url of ["http://example.com/api/v1", "https://127.0.0.1/api/v1", "http://127.1/api/v1", "http://[::1]/api/v1", "http://2130706433/api/v1", "http://127.0.0.1/api/v1?", "http://127.0.0.1/api/v1#", "http://127.0.0.1:0/api/v1", "http://127.0.0.1:99999/api/v1", "http://127.0.0.1/api/../api/v1", `http://${TOKEN}@127.0.0.1/api/v1`]) {
    assert.throws(() => loadConfig({ TOAST_IT_HTTP_URL: url }), error => error instanceof Error && !error.message.includes(TOKEN));
  }
  for (const env of [{ TOAST_IT_CONFIG_ROOT: "relative" }, { XDG_CONFIG_HOME: "relative" }, { TOAST_IT_TIMEOUT_MS: "999" }, { TOAST_IT_TIMEOUT_MS: "NaN" }, { TOAST_IT_OUTPUT_BYTES: "51201" }, { TOAST_IT_OUTPUT_BYTES: "1.5" }]) {
    assert.throws(() => loadConfig(env));
  }
});

test("discovery pages cover every tool; exact lookup preserves complete schema", async t => {
  const { config, seen } = await fixture(t);
  const names: unknown[] = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const page = await discover(config, { offset, limit: 2 });
    names.push(...(page.payload.tools as Array<{ name: string }>).map(tool => tool.name));
    offset = page.payload.nextOffset as number | null;
  }
  assert.deepEqual(names, tools.map(tool => tool.name));
  assert.deepEqual((await discover(config, { name: "sql.query" })).payload, tools[3]);
  assert.deepEqual((await discover(config, { offset: 100 })).payload.tools, []);
  for (const request of seen) {
    assert.equal(request.method, "GET"); assert.equal(request.body, "");
    assert.equal(request.headers.authorization, `Bearer ${TOKEN}`);
    assert.equal(request.headers.origin, undefined); assert.equal(request.headers["sec-fetch-site"], undefined);
  }
  await assert.rejects(discover(config, { name: "missing" }), /not found/);
  await assert.rejects(discover(config, { offset: -1 }), /offset/);
});

test("fresh discovery then exact POST wrapper for every exposed tool", async t => {
  const { config, seen } = await fixture(t);
  for (const tool of tools) {
    assert.equal((await callTool(config, tool.name, { name: "test" })).httpStatus, 200);
  }
  assert.equal(seen.length, tools.length * 2);
  for (let i = 0; i < seen.length; i += 2) {
    assert.equal(seen[i].path, "/api/v1/tools");
    assert.equal(seen[i + 1].path, `/api/v1/tools/${tools[i / 2].name}`);
    assert.equal(seen[i + 1].method, "POST");
    assert.deepEqual(JSON.parse(seen[i + 1].body), { arguments: { name: "test" } });
    assert.equal(seen[i + 1].headers["content-type"], "application/json");
  }
  await callTool(config, "note.get", {});
  assert.deepEqual(JSON.parse(seen.at(-1)!.body), { arguments: {} });
});

test("invalid routes, unknown names and non-object arguments never POST", async t => {
  const { config, seen } = await fixture(t);
  for (const name of ["../health", "..", ".", "note.get?x", "note%2eget", "note/get", "NOTE.get", "unknown"]) await assert.rejects(callTool(config, name, {}));
  for (const args of [null, [], "{}", 1]) await assert.rejects(callTool(config, "note.get", args), /JSON object/);
  await assert.rejects(callTool(config, "note.create", { name: "x".repeat(65536) }), error => error instanceof Error && /64 KiB/.test(error.message) && !/unknown/.test(error.message));
  await assert.rejects(callTool(config, "note.create", { name: TOKEN }), /Credentials/);
  assert(seen.every(req => req.method === "GET"));
});

test("202 is not execution; only explicit GET polls, stored results can be text", async t => {
  let state = "PENDING";
  const { config, seen } = await fixture(t, (req, res) => {
    if (req.url === "/api/v1/tools") json(res, { apiVersion: "v1", tools });
    else if (req.method === "POST") json(res, { ok: true, success: true, status: "approval_required", approvalId: ID, capability: "never-visible" }, 202);
    else json(res, { approvalId: ID, tool: "note.delete", status: state, result: "Plain stored result" });
  });
  const staged = await callTool(config, "note.delete", {});
  assert.equal(staged.httpStatus, 202);
  assert.equal(staged.payload.executed, false);
  assert.match(staged.summary, /Not executed/);
  assert.match(staged.summary, /Toast-It's Chat/);
  assert(!JSON.stringify(modelResult(staged, 2048)).includes("never-visible"));
  assert.equal(seen.length, 2);
  for (const next of ["PENDING", "APPROVED", "DENIED", "EXECUTED", "STALE", "FAILED"]) {
    state = next;
    const reply = await approval(config, ID);
    assert.equal(reply.payload.status, next);
    assert.equal(reply.payload.result, "Plain stored result");
  }
  assert.equal(seen.filter(req => req.method === "POST").length, 1);
  assert.equal(seen.filter(req => req.path === `/api/v1/approvals/${ID}`).length, 6);
  await assert.rejects(approval(config, "../tools"), /UUID/);
});

test("health and token rotation reread credential, not cached", async t => {
  const { config, tokenPath, seen } = await fixture(t);
  assert.match((await health(config)).summary, /ready/);
  await writeFile(tokenPath, "b".repeat(43), { mode: 0o600 });
  await health(config);
  assert.equal(seen[1].headers.authorization, `Bearer ${"b".repeat(43)}`);
});

test("missing, malformed, public and linked credentials fail safely without networking", async t => {
  const { config, tokenPath, root, seen } = await fixture(t);
  await chmod(tokenPath, 0o644);
  await assert.rejects(health(config), /0600/);
  await chmod(tokenPath, 0o600);
  await writeFile(tokenPath, "bad");
  await assert.rejects(health(config), /credential/);
  await writeFile(tokenPath, "\u00e1".repeat(21) + "a");
  await assert.rejects(health(config), /credential/);
  await rm(tokenPath);
  await assert.rejects(health(config), /credential/);
  const target = join(root, "actual-token");
  await writeFile(target, TOKEN, { mode: 0o600 });
  await symlink(target, tokenPath);
  await assert.rejects(health(config), /credential/);
  assert.equal(seen.length, 0);
});

test("credential roots reject links and unsafe permissions; server-valid token lengths are accepted", async t => {
  const { config, root, tokenPath, seen } = await fixture(t);
  await chmod(root, 0o770);
  await assert.rejects(health(config), /root must be owned/);
  await chmod(root, 0o700);
  const linked = join(root, "linked-root");
  await symlink(root, linked);
  await assert.rejects(health({ ...config, tokenPath: join(linked, "http-api.token") }), /linked path/);
  assert.equal(seen.length, 0);
  await writeFile(tokenPath, "z".repeat(128));
  await health(config);
  assert.equal(seen[0].headers.authorization, `Bearer ${"z".repeat(128)}`);
  await writeFile(tokenPath, "z".repeat(129));
  await assert.rejects(health(config), /credential/);
});

test("HTTP errors preserve safe structure, never credentials; no POST retry", async t => {
  for (const status of [400, 401, 403, 404, 413, 415, 500, 502, 503, 504]) {
    await t.test(String(status), async t => {
      const { config, seen } = await fixture(t, (req, res) => {
        if (req.url === "/api/v1/tools") json(res, { apiVersion: "v1", tools });
        else json(res, { ok: false, error: { code: "example", category: "EXECUTION_FAILED", message: `Bearer ${TOKEN}` }, capability: "hidden", token: TOKEN }, status);
      });
      await assert.rejects(callTool(config, "note.create", {}), error => {
        assert(error instanceof Error);
        assert.match(error.message, new RegExp(`HTTP ${status}`));
        assert.match(error.message, /example/);
        assert.match(error.message, /Do not retry/);
        assert(!error.message.includes(TOKEN)); assert(!error.message.includes("hidden"));
        return true;
      });
      assert.equal(seen.filter(req => req.method === "POST").length, 1);
    });
  }
});

test("200 failure, unavailable, and malformed 202/200 envelopes stay distinct", async t => {
  let body: unknown = { ok: false, status: "failure", error: { code: "domain_failed" } };
  let status = 200;
  const { config } = await fixture(t, (req, res) => {
    if (req.url === "/api/v1/tools") json(res, { apiVersion: "v1", tools });
    else json(res, body, status);
  });
  await assert.rejects(callTool(config, "note.get", {}), /domain_failed/);
  body = { ok: true, status: "unavailable", data: { available: false } };
  assert.match((await callTool(config, "note.get", {})).summary, /unavailable/);
  body = { ok: true, status: "approval_required", approvalId: ID };
  await assert.rejects(callTool(config, "note.delete", {}), /protocol error/);
  status = 202; body = { ok: true, status: "success" };
  await assert.rejects(callTool(config, "note.delete", {}), /invalid approval/);
  status = 200; body = {};
  await assert.rejects(callTool(config, "note.get", {}), /protocol error/);
});

test("actual conditional web tools return plain success objects, not execution envelopes", async t => {
  const results = {
    web_search: { query: "example", resultCount: 1, truncated: false, results: [{ title: "Example", url: "https://example.com" }] },
    web_fetch: { url: "https://example.com", textFound: true, truncated: false, title: "Example", contentType: "text/html", text: "Example content" },
  };
  const { config } = await fixture(t, (req, res) => {
    if (req.url === "/api/v1/tools") json(res, { apiVersion: "v1", tools });
    else json(res, results[req.url!.endsWith("web_search") ? "web_search" : "web_fetch"]);
  });
  for (const [name, expected] of Object.entries(results)) {
    const reply = await callTool(config, name, {});
    assert.deepEqual(reply.payload, expected);
    assert.match(reply.summary, /without an execution-status envelope/);
    assert(!reply.summary.includes("reported success"));
  }
});

test("plain-text embedded credential assignments are redacted too", async t => {
  const { config } = await fixture(t, (_req, res) => json(res, {
    approvalId: ID, status: "FAILED", result: 'Stored text: "capability": "secret with spaces", token=other-secret; still plain text',
  }));
  const result = JSON.stringify(await approval(config, ID));
  assert(!result.includes("secret with spaces"));
  assert(!result.includes("other-secret"));
});

test("response redaction covers nested objects, encoded approval JSON, bearer text and terminal controls", async t => {
  const { config } = await fixture(t, (_req, res) => json(res, {
    approvalId: ID, status: "EXECUTED", result: JSON.stringify({ ok: true, capability: "hidden-cap", data: { authorization: "secret-auth", token: TOKEN, message: `Echo ${TOKEN} hidden-cap secret-auth Bearer other-secret \u001b[31m` } }),
  }));
  const result = JSON.stringify(modelResult(await approval(config, ID), 24576));
  for (const secret of [TOKEN, "hidden-cap", "secret-auth", "other-secret", "\\u001b"]) assert(!result.includes(secret), secret);
});

test("redirects never forward auth; malformed and oversized responses are bounded", async t => {
  let mode = "redirect";
  const { config, seen } = await fixture(t, (req, res) => {
    if (req.url === "/api/v1/tools") return json(res, { apiVersion: "v1", tools });
    if (mode === "redirect") { res.writeHead(302, { Location: "/leaked" }); res.end(); }
    if (mode === "html") { res.writeHead(200, { "Content-Type": "text/html" }); res.end(TOKEN); }
    if (mode === "json") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(`invalid ${TOKEN}`); }
    if (mode === "large") json(res, { ok: true, status: "success", data: "x".repeat(262144) });
  });
  for (mode of ["redirect", "html", "json", "large"]) {
    await assert.rejects(callTool(config, "note.create", {}), error => error instanceof Error && !error.message.includes(TOKEN) && /Do not retry/.test(error.message));
  }
  assert(!seen.some(req => req.path === "/leaked"));
  assert.equal(seen.filter(req => req.method === "POST").length, 4);
});

test("deadline bounds stalled response bodies and caller abort reasons stay private", async t => {
  const { config, seen } = await fixture(t, (req, res) => {
    if (req.url === "/api/v1/tools") json(res, { apiVersion: "v1", tools });
    else { res.writeHead(200, { "Content-Type": "application/json" }); res.write('{"ok":'); }
  });
  const fast: Config = { ...config, timeoutMs: 100 };
  await assert.rejects(callTool(fast, "note.create", {}), /timed out.*Outcome may be unknown/);
  assert.equal(seen.filter(req => req.method === "POST").length, 1);
  const controller = new AbortController();
  controller.abort(new Error(TOKEN));
  const count = seen.length;
  await assert.rejects(health(config, controller.signal), error => error instanceof Error && /cancelled/.test(error.message) && !error.message.includes(TOKEN));
  assert.equal(seen.length, count);
  const active = new AbortController();
  const timer = setTimeout(() => active.abort(new Error(TOKEN)), 100);
  try { await assert.rejects(callTool(config, "note.create", {}, active.signal), /cancelled.*Outcome may be unknown/); }
  finally { clearTimeout(timer); }
});

test("requests bypass global proxy dispatchers", async t => {
  const { config } = await fixture(t);
  const original = getGlobalDispatcher();
  const proxy = new MockAgent();
  proxy.disableNetConnect();
  setGlobalDispatcher(proxy);
  try { assert.match((await health(config)).summary, /ready/); }
  finally { setGlobalDispatcher(original); await proxy.close(); }
});

test("connection refusal is actionable and sanitized", async t => {
  const { config, server } = await fixture(t);
  await new Promise<void>(resolve => server.close(() => resolve()));
  await assert.rejects(health(config), error => error instanceof Error && /httpApiEnabled/.test(error.message) && !error.message.includes(TOKEN));
});

test("catalog protocol failures and too-large schema are never partially presented", async t => {
  let body: unknown = { apiVersion: "v2", tools };
  const { config } = await fixture(t, (_req, res) => json(res, body));
  await assert.rejects(discover(config), /catalog/);
  body = { apiVersion: "v1", tools: [tools[0], tools[0]] };
  await assert.rejects(discover(config), /duplicate/);
  body = { apiVersion: "v1", tools: [{ ...tools[0], description: "x".repeat(3000) }] };
  await assert.rejects(discover({ ...config, outputBytes: 2048 }, { name: "note.get" }), /complete schema exceeds/);
});

test("model output is UTF-8 byte bounded, marked, compact in details; summary survives", () => {
  const reply = { summary: "HTTP 200: tool reported success.", httpStatus: 200, payload: { data: "😀\n".repeat(10000) } };
  const output = modelResult(reply, 2048);
  assert(Buffer.byteLength(output.content[0].text) <= 2048);
  assert.match(output.content[0].text, /Output truncated/);
  assert.match(output.content[0].text, /Do not repeat a mutation/);
  assert(!output.content[0].text.includes("�"));
  assert(output.content[0].text.split("\n").length < 10);
  assert.equal(output.details.truncated, true);
  assert(Buffer.byteLength(JSON.stringify(output.details)) < 200);
});
