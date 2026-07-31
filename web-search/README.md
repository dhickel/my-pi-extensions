# Pi Web Search Extension

Adds two tools backed by a local SearXNG instance:

- `web_search` searches SearXNG JSON results (default `http://127.0.0.1:8888`).
- `web_fetch` fetches HTTP(S) pages and returns structured metadata plus readable text, simple Markdown, HTML, raw text, or metadata-only output.

The package is a Pi package (`pi.extensions = ["./index.ts"]`) and can be installed or loaded like the other repository extensions.

## Tools

### `web_search`

Parameters include `query`, optional `baseUrl`, `categories`, `engines`, `language`, `safesearch`, `timeRange`, `page`, `maxResults`, and `timeoutMs`.

The result includes organic results, answers, corrections, suggestions, infoboxes, and unresponsive engine diagnostics.

### `web_fetch`

Parameters include `url`, `format` (`readable`, `markdown`, `html`, `raw`, `metadata`), `maxBytes`, `timeoutMs`, and `followRedirects`.

HTML pages are decoded into title, description, canonical URL, top headings, readable text or simple Markdown. Non-HTML content is returned as text with headers and truncation metadata.
