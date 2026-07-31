import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import {
	buildSearchUrl,
	coerceSearchResponse,
	extractHtmlMetadata,
	fetchBytes,
	fetchSearxng,
	htmlToMarkdown,
	htmlToReadableText,
	withTimeout,
} from "../core.ts";

test("buildSearchUrl targets SearXNG JSON search with optional filters", () => {
	const url = new URL(
		buildSearchUrl({
			baseUrl: "http://127.0.0.1:8888/",
			query: "pi coding agent",
			categories: ["it", "science"],
			engines: ["duckduckgo", "wikipedia"],
			language: "en",
			safesearch: 1,
			timeRange: "month",
			page: 3,
		}),
	);
	assert.equal(url.origin + url.pathname, "http://127.0.0.1:8888/search");
	assert.equal(url.searchParams.get("q"), "pi coding agent");
	assert.equal(url.searchParams.get("format"), "json");
	assert.equal(url.searchParams.get("categories"), "it,science");
	assert.equal(url.searchParams.get("engines"), "duckduckgo,wikipedia");
	assert.equal(url.searchParams.get("language"), "en");
	assert.equal(url.searchParams.get("safesearch"), "1");
	assert.equal(url.searchParams.get("time_range"), "month");
	assert.equal(url.searchParams.get("pageno"), "3");
});

test("coerceSearchResponse preserves rich SearXNG fields and caps returned results", () => {
	const response = coerceSearchResponse(
		{
			query: "example",
			results: [
				{ title: "A", url: "https://a.test", content: "Alpha", engines: ["e1"], score: 1.5, parsed_url: ["https", "a.test"] },
				{ title: "B", url: "https://b.test" },
			],
			answers: ["answer"],
			corrections: ["correction"],
			suggestions: ["suggestion"],
			infoboxes: [{ title: "box" }],
			unresponsive_engines: [["bad", "timeout"]],
		},
		{ query: "fallback", maxResults: 1 },
	);
	assert.equal(response.query, "example");
	assert.equal(response.resultCount, 2);
	assert.equal(response.results.length, 1);
	assert.deepEqual(response.results[0]?.engines, ["e1"]);
	assert.deepEqual(response.answers, ["answer"]);
	assert.deepEqual(response.unresponsiveEngines, [["bad", "timeout"]]);
});

test("HTML extraction produces readable text, markdown, and metadata", () => {
	const html = `<!doctype html><html><head>
		<title>Example &amp; Test</title>
		<meta name="description" content="A &quot;short&quot; page">
		<link rel="canonical" href="/canonical">
		<style>body{}</style><script>bad()</script>
		</head><body><h1>Main</h1><p>Hello <a href="https://example.test/x">world</a>.</p><ul><li>One</li></ul></body></html>`;
	const text = htmlToReadableText(html);
	assert.match(text, /Main/);
	assert.match(text, /Hello world\./);
	assert.doesNotMatch(text, /bad\(\)/);
	const markdown = htmlToMarkdown(html);
	assert.match(markdown, /# Main/);
	assert.match(markdown, /\[world\]\(https:\/\/example.test\/x\)/);
	const metadata = extractHtmlMetadata(html, "https://example.test/page");
	assert.equal(metadata.title, "Example & Test");
	assert.equal(metadata.description, 'A "short" page');
	assert.equal(metadata.canonicalUrl, "https://example.test/canonical");
});

test("fetchSearxng and fetchBytes work against local HTTP server", async () => {
	const server = createServer((request, response) => {
		if (request.url?.startsWith("/search")) {
			response.setHeader("content-type", "application/json");
			response.end(JSON.stringify({ query: "q", results: [{ title: "Hit", url: "https://example.test" }] }));
			return;
		}
		response.setHeader("content-type", "text/html; charset=utf-8");
		response.end("<html><head><title>Fetched</title></head><body><h1>Fetched</h1><p>Body text</p></body></html>");
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		const address = server.address();
		assert.ok(address && typeof address === "object");
		const baseUrl = `http://127.0.0.1:${address.port}`;
		const search = await withTimeout((signal) => fetchSearxng({ baseUrl, query: "q" }, signal), 5_000);
		assert.equal(search.results[0]?.title, "Hit");
		const page = await withTimeout((signal) => fetchBytes(`${baseUrl}/page`, { url: `${baseUrl}/page`, format: "readable" }, signal), 5_000);
		assert.equal(page.title, "Fetched");
		assert.match(page.text ?? "", /Body text/);
	} finally {
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	}
});
