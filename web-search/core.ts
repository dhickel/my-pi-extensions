export const DEFAULT_SEARXNG_BASE_URL = "http://127.0.0.1:8888";
export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_FETCH_MAX_BYTES = 2_000_000;
export const MODEL_OUTPUT_MAX_BYTES = 50 * 1024;
export const MODEL_OUTPUT_MAX_LINES = 2_000;
export const USER_AGENT =
	"PiWebSearch/0.1 (+https://github.com/earendil-works/pi-coding-agent; local agent web tool)";

export const SEARCH_CATEGORIES = ["general", "images", "videos", "news", "map", "music", "it", "science", "files", "social media"] as const;
export const SAFESEARCH_LEVELS = [0, 1, 2] as const;
export const TIME_RANGES = ["day", "week", "month", "year"] as const;
export const FETCH_FORMATS = ["readable", "markdown", "html", "raw", "metadata"] as const;

export type SearchCategory = (typeof SEARCH_CATEGORIES)[number];
export type TimeRange = (typeof TIME_RANGES)[number];
export type FetchFormat = (typeof FETCH_FORMATS)[number];

export interface SearchOptions {
	baseUrl?: string;
	query: string;
	categories?: SearchCategory[];
	engines?: string[];
	language?: string;
	safesearch?: 0 | 1 | 2;
	timeRange?: TimeRange;
	page?: number;
	maxResults?: number;
}

export interface SearchResult {
	title: string;
	url: string;
	content?: string;
	engine?: string;
	engines?: string[];
	category?: string;
	template?: string;
	score?: number;
	publishedDate?: string;
	thumbnail?: string;
	imgSrc?: string;
	parsedUrl?: string[];
}

export interface SearchResponse {
	query: string;
	baseUrl: string;
	page: number;
	resultCount: number;
	results: SearchResult[];
	answers: string[];
	corrections: string[];
	suggestions: string[];
	infoboxes: unknown[];
	unresponsiveEngines: unknown[];
}

export interface FetchOptions {
	url: string;
	format?: FetchFormat;
	maxBytes?: number;
	timeoutMs?: number;
	followRedirects?: boolean;
}

export interface FetchResponse {
	url: string;
	finalUrl: string;
	status: number;
	ok: boolean;
	contentType: string;
	bytesRead: number;
	truncated: boolean;
	format: FetchFormat;
	title?: string;
	description?: string;
	canonicalUrl?: string;
	text?: string;
	html?: string;
	metadata: Record<string, unknown>;
}

export function normalizeBaseUrl(baseUrl = DEFAULT_SEARXNG_BASE_URL): string {
	const parsed = new URL(baseUrl);
	parsed.pathname = parsed.pathname.replace(/\/+$/, "");
	parsed.search = "";
	parsed.hash = "";
	return parsed.toString().replace(/\/$/, "");
}

export function buildSearchUrl(options: SearchOptions): string {
	const url = new URL(`${normalizeBaseUrl(options.baseUrl)}/search`);
	url.searchParams.set("q", options.query);
	url.searchParams.set("format", "json");
	if (options.categories?.length) url.searchParams.set("categories", options.categories.join(","));
	if (options.engines?.length) url.searchParams.set("engines", options.engines.join(","));
	if (options.language) url.searchParams.set("language", options.language);
	if (options.safesearch !== undefined) url.searchParams.set("safesearch", String(options.safesearch));
	if (options.timeRange) url.searchParams.set("time_range", options.timeRange);
	if (options.page && options.page > 1) url.searchParams.set("pageno", String(options.page));
	return url.toString();
}

export function capModelText(text: string, maxBytes = MODEL_OUTPUT_MAX_BYTES, maxLines = MODEL_OUTPUT_MAX_LINES) {
	const lines = text.split("\n");
	let candidate = lines.slice(0, maxLines).join("\n");
	let truncated = lines.length > maxLines;
	const bytes = Buffer.byteLength(candidate, "utf8");
	if (bytes > maxBytes) {
		candidate = Buffer.from(candidate, "utf8").subarray(0, maxBytes).toString("utf8").replace(/�+$/, "");
		truncated = true;
	}
	return { text: candidate, truncated };
}

export function decodeHtmlEntities(value: string): string {
	const named: Record<string, string> = {
		amp: "&",
		lt: "<",
		gt: ">",
		quot: '"',
		apos: "'",
		nbsp: " ",
		mdash: "—",
		ndash: "–",
		hellip: "…",
	};
	return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (match, entity: string) => {
		if (entity[0] === "#") {
			const code = entity[1]?.toLowerCase() === "x" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
			return Number.isFinite(code) ? String.fromCodePoint(code) : match;
		}
		return named[entity.toLowerCase()] ?? match;
	});
}

function attrValue(tag: string, name: string): string | undefined {
	const pattern = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
	const match = tag.match(pattern);
	return decodeHtmlEntities(match?.[2] ?? match?.[3] ?? match?.[4] ?? "") || undefined;
}

function removeBoilerplate(html: string): string {
	return html
		.replace(/<!--[\s\S]*?-->/g, " ")
		.replace(/<script\b[\s\S]*?<\/script>/gi, " ")
		.replace(/<style\b[\s\S]*?<\/style>/gi, " ")
		.replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
		.replace(/<svg\b[\s\S]*?<\/svg>/gi, " ");
}

function visibleHtml(html: string): string {
	const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1];
	return body ?? html.replace(/<head\b[\s\S]*?<\/head>/gi, " ");
}

export function htmlToReadableText(html: string): string {
	return decodeHtmlEntities(
		removeBoilerplate(visibleHtml(html))
			.replace(/<(?:h[1-6]|p|li|blockquote|pre|tr|div|section|article|br)\b[^>]*>/gi, "\n")
			.replace(/<\/\s*(?:h[1-6]|p|li|blockquote|pre|tr|div|section|article)>/gi, "\n")
			.replace(/<[^>]+>/g, " ")
			.replace(/[ \t\f\v]+/g, " ")
			.replace(/\s+([.,;:!?])/g, "$1")
			.replace(/\n[ \t]+/g, "\n")
			.replace(/\n{3,}/g, "\n\n")
			.trim(),
	);
}

export function htmlToMarkdown(html: string): string {
	let body = removeBoilerplate(html);
	body = body.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_all, attrs: string, label: string) => {
		const href = attrValue(attrs, "href");
		const text = htmlToReadableText(label);
		return href && text ? `[${text}](${href})` : text;
	});
	body = body.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_all, level: string, text: string) => `\n${"#".repeat(Number(level))} ${htmlToReadableText(text)}\n`);
	body = body.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_all, text: string) => `\n- ${htmlToReadableText(text)}`);
	body = body.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (_all, text: string) => `\n\n${htmlToReadableText(text)}\n`);
	return htmlToReadableText(body).replace(/\n{3,}/g, "\n\n");
}

export function extractHtmlMetadata(html: string, finalUrl: string) {
	const titleMatch = removeBoilerplate(html).match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
	const metadata: Record<string, unknown> = {};
	let description: string | undefined;
	let canonicalUrl: string | undefined;
	const headings: Array<{ level: number; text: string }> = [];
	for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
		const tag = match[0];
		const name = attrValue(tag, "name") ?? attrValue(tag, "property");
		const content = attrValue(tag, "content");
		if (!name || !content) continue;
		metadata[name] = content;
		if (name.toLowerCase() === "description" || name.toLowerCase() === "og:description") description ??= content;
	}
	for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
		const tag = match[0];
		if (attrValue(tag, "rel")?.toLowerCase() === "canonical") {
			const href = attrValue(tag, "href");
			if (href) canonicalUrl = new URL(href, finalUrl).toString();
		}
	}
	for (const match of html.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
		headings.push({ level: Number(match[1]), text: htmlToReadableText(match[2] ?? "") });
		if (headings.length >= 20) break;
	}
	metadata.headings = headings;
	return {
		title: titleMatch ? htmlToReadableText(titleMatch[1] ?? "") : undefined,
		description,
		canonicalUrl,
		metadata,
	};
}

export function coerceSearchResponse(payload: any, options: SearchOptions): SearchResponse {
	const results = Array.isArray(payload?.results) ? payload.results : [];
	const maxResults = Math.min(Math.max(options.maxResults ?? 10, 1), 50);
	return {
		query: String(payload?.query ?? options.query),
		baseUrl: normalizeBaseUrl(options.baseUrl),
		page: options.page ?? 1,
		resultCount: results.length,
		results: results.slice(0, maxResults).map((result: any): SearchResult => ({
			title: String(result.title ?? ""),
			url: String(result.url ?? ""),
			content: result.content === undefined ? undefined : String(result.content),
			engine: result.engine === undefined ? undefined : String(result.engine),
			engines: Array.isArray(result.engines) ? result.engines.map(String) : undefined,
			category: result.category === undefined ? undefined : String(result.category),
			template: result.template === undefined ? undefined : String(result.template),
			score: typeof result.score === "number" ? result.score : undefined,
			publishedDate: result.publishedDate === undefined ? undefined : String(result.publishedDate),
			thumbnail: result.thumbnail === undefined ? undefined : String(result.thumbnail),
			imgSrc: result.img_src === undefined ? undefined : String(result.img_src),
			parsedUrl: Array.isArray(result.parsed_url) ? result.parsed_url.map(String) : undefined,
		})),
		answers: Array.isArray(payload?.answers) ? payload.answers.map(String) : [],
		corrections: Array.isArray(payload?.corrections) ? payload.corrections.map(String) : [],
		suggestions: Array.isArray(payload?.suggestions) ? payload.suggestions.map(String) : [],
		infoboxes: Array.isArray(payload?.infoboxes) ? payload.infoboxes : [],
		unresponsiveEngines: Array.isArray(payload?.unresponsive_engines) ? payload.unresponsive_engines : [],
	};
}

export async function fetchSearxng(options: SearchOptions, signal?: AbortSignal): Promise<SearchResponse> {
	if (!options.query.trim()) throw new Error("Search query must not be empty.");
	const response = await fetch(buildSearchUrl(options), {
		signal,
		headers: { Accept: "application/json", "User-Agent": USER_AGENT },
	});
	if (!response.ok) throw new Error(`SearXNG search failed: HTTP ${response.status} ${response.statusText}`);
	return coerceSearchResponse(await response.json(), options);
}

export async function fetchBytes(url: string, options: FetchOptions, signal?: AbortSignal): Promise<FetchResponse> {
	const parsed = new URL(url);
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("web_fetch only supports http and https URLs.");
	const maxBytes = Math.min(Math.max(options.maxBytes ?? DEFAULT_FETCH_MAX_BYTES, 1_024), 20_000_000);
	const response = await fetch(parsed, {
		signal,
		redirect: options.followRedirects === false ? "manual" : "follow",
		headers: {
			Accept: "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.8",
			"User-Agent": USER_AGENT,
		},
	});
	const chunks: Uint8Array[] = [];
	let bytesRead = 0;
	let truncated = false;
	for await (const chunk of response.body ?? []) {
		const bytes = chunk instanceof Uint8Array ? chunk : Buffer.from(chunk);
		if (bytesRead + bytes.byteLength > maxBytes) {
			chunks.push(bytes.subarray(0, maxBytes - bytesRead));
			bytesRead = maxBytes;
			truncated = true;
			break;
		}
		chunks.push(bytes);
		bytesRead += bytes.byteLength;
	}
	const buffer = Buffer.concat(chunks);
	const contentType = response.headers.get("content-type") ?? "";
	const charset = contentType.match(/charset=([^;]+)/i)?.[1]?.trim().toLowerCase();
	const body = new TextDecoder(charset || "utf-8", { fatal: false }).decode(buffer);
	const format = options.format ?? "readable";
	const base: FetchResponse = {
		url,
		finalUrl: response.url || url,
		status: response.status,
		ok: response.ok,
		contentType,
		bytesRead,
		truncated,
		format,
		metadata: {
			headers: Object.fromEntries(response.headers.entries()),
		},
	};
	const isHtml = /\bhtml\b/i.test(contentType) || /<html[\s>]/i.test(body);
	if (!isHtml) {
		return { ...base, text: body };
	}
	const extracted = extractHtmlMetadata(body, response.url || url);
	const text = format === "markdown" ? htmlToMarkdown(body) : htmlToReadableText(body);
	return {
		...base,
		...extracted,
		metadata: { ...base.metadata, ...extracted.metadata },
		text: format === "html" ? undefined : text,
		html: format === "html" || format === "raw" ? body : undefined,
	};
}

export async function withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs = DEFAULT_TIMEOUT_MS, parent?: AbortSignal): Promise<T> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
	const abort = () => controller.abort(parent?.reason ?? new Error("Aborted"));
	try {
		if (parent?.aborted) abort();
		else parent?.addEventListener("abort", abort, { once: true });
		return await operation(controller.signal);
	} finally {
		clearTimeout(timer);
		parent?.removeEventListener("abort", abort);
	}
}
