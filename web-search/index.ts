import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	DEFAULT_FETCH_MAX_BYTES,
	DEFAULT_SEARXNG_BASE_URL,
	DEFAULT_TIMEOUT_MS,
	FETCH_FORMATS,
	fetchBytes,
	fetchSearxng,
	MODEL_OUTPUT_MAX_BYTES,
	MODEL_OUTPUT_MAX_LINES,
	SAFESEARCH_LEVELS,
	SEARCH_CATEGORIES,
	TIME_RANGES,
	withTimeout,
	type FetchFormat,
	type SearchCategory,
	type TimeRange,
} from "./core.ts";

function literalEnum<const T extends readonly [string, ...string[]]>(values: T) {
	return Type.Union(values.map((value) => Type.Literal(value)) as any);
}

function modelVisible(payload: unknown) {
	const text = JSON.stringify(payload, null, 2);
	const lines = text.split("\n");
	let visible = lines.slice(0, MODEL_OUTPUT_MAX_LINES).join("\n");
	let truncated = lines.length > MODEL_OUTPUT_MAX_LINES;
	if (Buffer.byteLength(visible, "utf8") > MODEL_OUTPUT_MAX_BYTES) {
		visible = Buffer.from(visible, "utf8").subarray(0, MODEL_OUTPUT_MAX_BYTES).toString("utf8").replace(/�+$/, "");
		truncated = true;
	}
	return {
		content: [{ type: "text" as const, text: visible }],
		details: { payload, modelOutputTruncated: truncated },
	};
}

function renderToolText(theme: any, title: string, detail: string) {
	return new Text(`${theme.fg("toolTitle", theme.bold(title))}${theme.fg("dim", detail)}`, 0, 0);
}

export default function webSearchExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "web_search",
		label: "Web search",
		description:
			"Search the web through the local SearXNG instance (default http://127.0.0.1:8888). Returns structured organic results plus SearXNG answers, corrections, suggestions, infoboxes, and unresponsive engine diagnostics. Use web_fetch on promising result URLs to retrieve page content.",
		promptSnippet: "Search the web through local SearXNG",
		promptGuidelines: [
			"Use web_search when current external information, citations, documentation, or broad web discovery is needed.",
			"After web_search, use web_fetch on relevant result URLs before relying on page-specific claims.",
			"Prefer concise targeted web_search queries; use categories, language, timeRange, and engines only when they improve relevance.",
		],
		parameters: Type.Object(
			{
				query: Type.String({ description: "Search query to send to SearXNG." }),
				baseUrl: Type.Optional(
					Type.String({
						description: `SearXNG base URL. Defaults to ${DEFAULT_SEARXNG_BASE_URL}.`,
						default: DEFAULT_SEARXNG_BASE_URL,
					}),
				),
				categories: Type.Optional(
					Type.Array(literalEnum(SEARCH_CATEGORIES), {
						description: "Optional SearXNG categories to search.",
						uniqueItems: true,
					}),
				),
				engines: Type.Optional(
					Type.Array(Type.String(), {
						description: "Optional exact SearXNG engine names to query, for example ['google', 'bing', 'duckduckgo'] depending on local configuration.",
						uniqueItems: true,
					}),
				),
				language: Type.Optional(Type.String({ description: "Optional SearXNG language code such as 'en', 'en-US', or 'all'." })),
				safesearch: Type.Optional(Type.Union([Type.Literal(0), Type.Literal(1), Type.Literal(2)])),
				timeRange: Type.Optional(literalEnum(TIME_RANGES)),
				page: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 1 })),
				maxResults: Type.Optional(Type.Number({ minimum: 1, maximum: 50, default: 10 })),
				timeoutMs: Type.Optional(Type.Number({ minimum: 1_000, maximum: 120_000, default: DEFAULT_TIMEOUT_MS })),
			},
			{ additionalProperties: false },
		),
		async execute(_toolCallId, params, signal) {
			const response = await withTimeout(
				(abortSignal) =>
					fetchSearxng(
						{
							baseUrl: params.baseUrl,
							query: params.query,
							categories: params.categories as SearchCategory[] | undefined,
							engines: params.engines,
							language: params.language,
							safesearch: params.safesearch === undefined ? undefined : (Number(params.safesearch) as 0 | 1 | 2),
							timeRange: params.timeRange as TimeRange | undefined,
							page: params.page,
							maxResults: params.maxResults,
						},
						abortSignal,
					),
				params.timeoutMs,
				signal,
			);
			return modelVisible(response);
		},
		renderCall(args, theme) {
			return renderToolText(theme, "web search ", args.query ?? "");
		},
		renderResult(result, _options, theme) {
			const payload = (result.details as any)?.payload;
			return renderToolText(theme, "results ", `${payload?.results?.length ?? 0}/${payload?.resultCount ?? 0}`);
		},
	});

	pi.registerTool({
		name: "web_fetch",
		label: "Fetch web page",
		description:
			"Fetch an http(s) URL and return model-friendly page content. HTML pages are parsed into title, description, canonical URL, headings, readable text, optional simple Markdown, or raw HTML. Non-HTML responses are returned as text with headers and truncation metadata.",
		promptSnippet: "Fetch and extract content from web pages",
		promptGuidelines: [
			"Use web_fetch after web_search to verify page-specific claims and gather citations from source pages.",
			"Use web_fetch format 'readable' for most pages, 'markdown' when link/heading structure matters, 'metadata' for quick page identity, and 'html' or 'raw' only when source markup is needed.",
			"Do not assume web_fetch received the entire page when its truncated flag is true; narrow the request or fetch a more specific source if needed.",
		],
		parameters: Type.Object(
			{
				url: Type.String({ description: "http(s) URL to retrieve." }),
				format: Type.Optional(literalEnum(FETCH_FORMATS)),
				maxBytes: Type.Optional(
					Type.Number({
						minimum: 1_024,
						maximum: 20_000_000,
						default: DEFAULT_FETCH_MAX_BYTES,
						description: "Maximum response bytes to read before truncating.",
					}),
				),
				timeoutMs: Type.Optional(Type.Number({ minimum: 1_000, maximum: 120_000, default: DEFAULT_TIMEOUT_MS })),
				followRedirects: Type.Optional(Type.Boolean({ default: true })),
			},
			{ additionalProperties: false },
		),
		async execute(_toolCallId, params, signal) {
			const response = await withTimeout(
				(abortSignal) =>
					fetchBytes(
						params.url,
						{
							url: params.url,
							format: params.format as FetchFormat | undefined,
							maxBytes: params.maxBytes,
							timeoutMs: params.timeoutMs,
							followRedirects: params.followRedirects,
						},
						abortSignal,
					),
				params.timeoutMs,
				signal,
			);
			if (params.format === "metadata") {
				const { text: _text, html: _html, ...metadataOnly } = response;
				return modelVisible(metadataOnly);
			}
			return modelVisible(response);
		},
		renderCall(args, theme) {
			return renderToolText(theme, "web fetch ", args.url ?? "");
		},
		renderResult(result, _options, theme) {
			const payload = (result.details as any)?.payload;
			return renderToolText(theme, "fetched ", `${payload?.status ?? "?"} ${payload?.contentType ?? ""}`);
		},
	});
}
