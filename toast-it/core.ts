import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { Agent, fetch } from "undici";

const REQUEST_BYTES = 64 * 1024;
const RESPONSE_BYTES = 256 * 1024;
const NAME = /^[A-Za-z0-9_.]{1,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AMBIGUOUS = " Outcome may be unknown. Do not retry the mutation; read current state first. If staged, check its approval ID instead.";
const APPROVAL = "Not executed. Wait for the user to review the External HTTP approval required card in Toast-It's Chat section or Assistant panel. Use toastit_approval for a single status check; do not re-invoke the mutation.";

type ObjectValue = Record<string, unknown>;
export interface Config {
  baseUrl: string;
  tokenPath: string;
  timeoutMs: number;
  outputBytes: number;
}
export interface Reply {
  summary: string;
  payload: ObjectValue;
  httpStatus: number;
}
export interface CatalogOptions { name?: string; offset?: number; limit?: number }
interface Tool extends ObjectValue { name: string; description: string; inputSchema: ObjectValue }

class ClientError extends Error {}
function fail(message: string): never { throw new ClientError(message); }
function object(value: unknown): value is ObjectValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function integer(value: string | undefined, fallback: number, min: number, max: number, name: string) {
  if (!value) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) {
    fail(`Invalid ${name}; use an integer from ${min} to ${max}.`);
  }
  return Number(value);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const raw = env.TOAST_IT_HTTP_URL || "http://127.0.0.1:47631/api/v1";
  // Validate the original spelling as well as the parsed URL: no encoded path,
  // userinfo, DNS aliases, query/fragment (even empty), or alternate IP syntax.
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(?::[0-9]{1,5})?\/api\/v1\/?$/.test(raw)) {
    fail("Invalid TOAST_IT_HTTP_URL; use http://127.0.0.1:47631/api/v1 (or localhost and a local port), without credentials, query, or fragment.");
  }
  let url: URL;
  try { url = new URL(raw); } catch { fail("Invalid TOAST_IT_HTTP_URL port."); }
  if (url.port === "0") fail("Invalid TOAST_IT_HTTP_URL port.");
  url.hostname = "127.0.0.1"; // Avoid localhost resolving to IPv6 or another address.
  const root = env.TOAST_IT_CONFIG_ROOT || join(env.XDG_CONFIG_HOME || join(env.HOME || homedir(), ".config"), "toast-it");
  if (!isAbsolute(root)) fail("Toast-It configuration root must be absolute. Check TOAST_IT_CONFIG_ROOT, XDG_CONFIG_HOME, or HOME.");
  return {
    baseUrl: url.href.replace(/\/$/, ""),
    tokenPath: join(root, "http-api.token"),
    timeoutMs: integer(env.TOAST_IT_TIMEOUT_MS, 20_000, 1_000, 60_000, "TOAST_IT_TIMEOUT_MS"),
    outputBytes: integer(env.TOAST_IT_OUTPUT_BYTES, 24 * 1024, 2_048, 50 * 1024, "TOAST_IT_OUTPUT_BYTES"),
  };
}

async function readToken(path: string): Promise<string> {
  try {
    const root = dirname(path);
    const rootStat = await lstat(root);
    if (!process.getuid || rootStat.uid !== process.getuid() || (rootStat.mode & 0o022) !== 0) throw new Error();
    for (let part = root; ; part = dirname(part)) {
      if ((await lstat(part)).isSymbolicLink()) throw new Error();
      if (dirname(part) === part) break;
    }
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || !process.getuid || stat.uid !== process.getuid() || (stat.size < 43 || stat.size > 128)) {
        throw new Error();
      }
      const bytes = Buffer.alloc(129);
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
      const token = bytes.subarray(0, bytesRead).toString("ascii");
      if (!/^[A-Za-z0-9_-]{43,128}$/.test(token) || bytes.subarray(0, bytesRead).some(b => b > 127)) throw new Error();
      return token;
    } finally { await file.close(); }
  } catch {
    fail("Cannot read a private Toast-It credential. Enable httpApiEnabled and restart Toast-It; check TOAST_IT_CONFIG_ROOT (or XDG_CONFIG_HOME/toast-it). The root must be owned, not group/other-writable, and have no linked path components; http-api.token must be an owned, regular, non-linked 0600 file with a valid token. Do not paste the token into Pi.");
  }
}

const SECRET_KEY = /^(capability|approvalcapability|token|apikey|aiapikey|authorization)$/i;
function collectSecrets(value: unknown, secrets: Set<string>, depth = 0): void {
  if (depth > 32) return;
  if (typeof value === "string" && /^\s*[\[{]/.test(value)) {
    try { collectSecrets(JSON.parse(value), secrets, depth + 1); } catch { /* plain text */ }
  } else if (Array.isArray(value)) {
    for (const item of value) collectSecrets(item, secrets, depth + 1);
  } else if (object(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_KEY.test(key.replace(/[_-]/g, "")) && typeof item === "string" && item) secrets.add(item);
      collectSecrets(item, secrets, depth + 1);
    }
  }
}

function sanitize(value: unknown, secrets: readonly string[], depth = 0): unknown {
  if (depth > 32) return "[depth limit]";
  if (typeof value === "string") {
    const text = secrets.reduce((text, secret) => text.replaceAll(secret, "[REDACTED]"), value);
    // Approval results are sometimes serialized JSON, sometimes plain text.
    if (/^\s*[\[{]/.test(text)) {
      try { return JSON.stringify(sanitize(JSON.parse(text), secrets, depth + 1)); } catch { /* plain text */ }
    }
    return text.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
      .replace(/(["']?)(capability|approvalCapability|apiKey|aiApiKey|token|authorization)\1\s*[:=]\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;]+)/gi, "$2=[REDACTED]")
      .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
  }
  if (Array.isArray(value)) return value.map(item => sanitize(item, secrets, depth + 1));
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    String(sanitize(key, secrets, depth + 1)),
    SECRET_KEY.test(key.replace(/[_-]/g, ""))
      ? "[REDACTED]" : sanitize(item, secrets, depth + 1),
  ]));
  return value;
}

async function request(config: Config, route: string, signal: AbortSignal, args?: ObjectValue, onDispatch?: () => void): Promise<{ status: number; body: ObjectValue }> {
  signal.throwIfAborted();
  const token = await readToken(config.tokenPath);
  signal.throwIfAborted();
  let body: string | undefined;
  if (args !== undefined) {
    try { body = JSON.stringify({ arguments: args }); } catch { fail("Tool arguments must be a JSON object."); }
    if (Buffer.byteLength(body) > REQUEST_BYTES) fail("Toast-It request exceeds 64 KiB. Narrow the arguments; nothing was sent.");
    if (body.includes(token)) fail("Credentials must not appear in tool arguments; nothing was sent.");
  }
  // A dedicated direct dispatcher bypasses environment/global proxy dispatchers.
  // Its lifetime is one request, including body consumption and cancellation.
  const dispatcher = new Agent({ connect: { timeout: config.timeoutMs } });
  try {
    const url = new URL(config.baseUrl);
    signal.throwIfAborted();
    onDispatch?.();
    const response = await fetch(config.baseUrl + route, {
      method: args === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Host: `127.0.0.1:${url.port || "80"}`,
        Accept: "application/json",
        ...(args === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body, signal, dispatcher, redirect: "error",
    });
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") || "")) {
      fail(`Toast-It protocol error (HTTP ${response.status}): expected JSON.`);
    }
    if (!response.body) fail("Toast-It protocol error: empty response.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > RESPONSE_BYTES) fail("Toast-It response exceeds 256 KiB. Narrow the query.");
      chunks.push(chunk);
    }
    let parsed: unknown;
    try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { fail("Toast-It protocol error: malformed JSON response."); }
    if (!object(parsed)) fail("Toast-It protocol error: expected a JSON object.");
    const secrets = new Set([token]);
    collectSecrets(parsed, secrets);
    const safe = sanitize(parsed, [...secrets].sort((a, b) => b.length - a.length)) as ObjectValue;
    if (response.status !== 200 && response.status !== 202) {
      const help = response.status === 401 ? " Authentication refused; verify the config root and restart Toast-It after token rotation."
        : response.status === 503 ? " Toast-It is busy or shutting down; check health before proceeding."
        : response.status === 502 ? " Result too large or server failure; narrow subsequent reads."
        : " Check the discovered schema and Toast-It state.";
      fail(`Toast-It HTTP ${response.status}.${help}\n${boundedJson(safe, 1_024)}`);
    }
    return { status: response.status, body: safe };
  } finally { await dispatcher.destroy(); }
}

function boundedJson(value: unknown, bytes: number): string {
  const text = JSON.stringify(value);
  const notice = " [error details truncated]";
  return Buffer.byteLength(text) <= bytes ? text : utf8Prefix(text, bytes - Buffer.byteLength(notice)) + notice;
}
function utf8Prefix(text: string, bytes: number) {
  const buffer = Buffer.from(text);
  if (buffer.length <= bytes) return text;
  let end = bytes;
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end--;
  return buffer.subarray(0, end).toString("utf8");
}

async function withDeadline<T>(config: Config, parent: AbortSignal | undefined, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(); // Never propagate an arbitrary secret-bearing abort reason.
  if (parent?.aborted) abort();
  parent?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, config.timeoutMs);
  try { return await run(controller.signal); }
  catch (error) {
    if (error instanceof ClientError) throw error;
    if (controller.signal.aborted) fail("Toast-It request cancelled or timed out.");
    return fail("Toast-It is unavailable or the connection failed. Enable httpApiEnabled, restart the resident application, and check TOAST_IT_HTTP_URL. Redirects are not allowed.");
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", abort);
  }
}

async function catalog(config: Config, signal: AbortSignal): Promise<Tool[]> {
  const { status, body } = await request(config, "/tools", signal);
  if (status !== 200 || body.apiVersion !== "v1" || !Array.isArray(body.tools)
    || !body.tools.every(tool => object(tool) && typeof tool.name === "string" && NAME.test(tool.name)
      && typeof tool.description === "string" && object(tool.inputSchema))) {
    fail("Toast-It protocol error: invalid v1 tool catalog.");
  }
  const tools = body.tools as Tool[];
  if (new Set(tools.map(tool => tool.name)).size !== tools.length) fail("Toast-It protocol error: duplicate tool names.");
  return tools;
}

export async function discover(config: Config, options: CatalogOptions = {}, parent?: AbortSignal): Promise<Reply> {
  return withDeadline(config, parent, async signal => {
    if (options.name !== undefined && !NAME.test(options.name)) fail("Use an exact discovered Toast-It tool name.");
    const offset = options.offset ?? 0, limit = options.limit ?? 20;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      fail("Catalog offset must be a non-negative integer and limit must be 1–100.");
    }
    const tools = await catalog(config, signal);
    if (options.name !== undefined) {
      const tool = tools.find(tool => tool.name === options.name);
      if (!tool) fail("Tool not found in the current Toast-It catalog. Use toastit_tools without a name.");
      if (Buffer.byteLength(JSON.stringify(tool)) > config.outputBytes - 512) {
        fail("This complete schema exceeds the output limit. Increase TOAST_IT_OUTPUT_BYTES (maximum 51200); do not call from a partial schema.");
      }
      return { summary: "Complete discovered tool schema. Follow this schema in toastit_call arguments.", payload: tool, httpStatus: 200 };
    }
    const items: ObjectValue[] = [];
    for (const tool of tools.slice(offset, offset + limit)) {
      const item = { name: tool.name, description: utf8Prefix(tool.description, 320), approvalRequired: tool.approvalRequired };
      if (Buffer.byteLength(JSON.stringify([...items, item])) > config.outputBytes - 700) break;
      items.push(item);
    }
    return {
      summary: "Toast-It catalog. Use toastit_tools with an exact name to read its complete inputSchema before calling.",
      payload: { tools: items, total: tools.length, offset, nextOffset: offset + items.length < tools.length ? offset + items.length : null },
      httpStatus: 200,
    };
  });
}

export async function callTool(config: Config, name: string, args: unknown, parent?: AbortSignal): Promise<Reply> {
  let sent = false;
  try {
    return await withDeadline(config, parent, async signal => {
      if (!NAME.test(name) || name === "." || name === "..") fail("Use an exact discovered Toast-It tool name.");
      if (!object(args)) fail("Tool arguments must be a JSON object, including {} for no arguments.");
      const tools = await catalog(config, signal);
      if (!tools.some(tool => tool.name === name)) fail("Tool not found in the current Toast-It catalog. Discover its schema first.");
      const { status, body } = await request(config, `/tools/${name}`, signal, args, () => { sent = true; });
      if (status === 202) {
        if (body.status !== "approval_required" || body.ok !== true || typeof body.approvalId !== "string" || !UUID.test(body.approvalId)) {
          fail("Toast-It protocol error: invalid approval-required response.");
        }
        return {
          summary: `HTTP 202 approval_required; approvalId=${body.approvalId}. ${APPROVAL}`,
          payload: { status: "approval_required", approvalId: body.approvalId, executed: false }, httpStatus: 202,
        };
      }
      if (body.ok === false || body.success === false || body.status === "failure") {
        fail(`Toast-It tool failed (HTTP 200).\n${boundedJson(body, 1_024)}`);
      }
      // WebToolCallback currently returns plain result objects on success,
      // despite the HTTP guide's general envelope description. Preserve those
      // results without inventing domain execution-success metadata.
      if (!("ok" in body) && !("success" in body) && !("status" in body) && Object.keys(body).length > 0) {
        return { summary: "HTTP 200: result data received without an execution-status envelope. Inspect the payload.", payload: body, httpStatus: 200 };
      }
      if (body.ok !== true || !["success", "unavailable"].includes(String(body.status))) {
        fail("Toast-It protocol error: invalid tool-result envelope.");
      }
      return { summary: body.status === "unavailable" ? "HTTP 200: tool unavailable; inspect data, not execution success." : "HTTP 200: tool reported success.", payload: body, httpStatus: 200 };
    });
  } catch (error) {
    // withDeadline has converted all external exceptions to fixed safe messages.
    throw new ClientError((error instanceof ClientError ? error.message : "Toast-It call failed.") + (sent ? AMBIGUOUS : ""));
  }
}

export async function approval(config: Config, id: string, parent?: AbortSignal): Promise<Reply> {
  return withDeadline(config, parent, async signal => {
    if (!UUID.test(id)) fail("approvalId must be the UUID returned by Toast-It HTTP 202.");
    const { status, body } = await request(config, `/approvals/${id}`, signal);
    const state = String(body.status);
    if (status !== 200 || body.approvalId !== id || !["PENDING", "APPROVED", "DENIED", "EXECUTED", "STALE", "FAILED"].includes(state)) {
      fail("Toast-It protocol error: invalid approval status.");
    }
    return {
      summary: `Approval ${id}: ${state}. ` + (state === "PENDING" || state === "APPROVED"
        ? "Execution is not confirmed. Wait for Toast-It UI approval/execution; no automatic polling."
        : state === "EXECUTED" ? "Inspect the stored result before claiming mutation success."
          : "Do not claim mutation success or re-invoke automatically."),
      payload: body, httpStatus: 200,
    };
  });
}

export async function health(config: Config, parent?: AbortSignal): Promise<Reply> {
  return withDeadline(config, parent, async signal => {
    const { status, body } = await request(config, "/health", signal);
    if (status !== 200 || body.apiVersion !== "v1" || body.status !== "ready") fail("Toast-It protocol error: expected v1 ready health status.");
    return { summary: "Toast-It HTTP API v1 is ready.", payload: body, httpStatus: 200 };
  });
}

export function modelResult(reply: Reply, maxBytes: number) {
  const header = reply.summary + "\n";
  const json = JSON.stringify(reply.payload);
  const notice = "\n[Output truncated; no full copy is stored. Narrow subsequent reads using discovered filters. Do not repeat a mutation to retrieve output.]";
  const truncated = Buffer.byteLength(header + json) > maxBytes;
  const text = truncated ? header + utf8Prefix(json, Math.max(0, maxBytes - Buffer.byteLength(header + notice))) + notice : header + json;
  return {
    content: [{ type: "text" as const, text }],
    // No unbounded payload, credentials, config, or hidden raw response in session details.
    details: { summary: reply.summary, httpStatus: reply.httpStatus, truncated },
  };
}
