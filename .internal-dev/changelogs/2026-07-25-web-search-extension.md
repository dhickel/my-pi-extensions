# Web Search Extension

## Date

2026-07-25

## Git Commit

d259525fac758c5b16710579ee3ce1db04c2a353

## Change Summary

Added a new Pi package extension that exposes SearXNG-backed web search and HTTP(S) page fetching tools.

## Files

- `web-search/package.json`
- `web-search/index.ts`
- `web-search/core.ts`
- `web-search/README.md`
- `web-search/test/core.test.ts`
- `/home/dhickel/.pi/agent/settings.json` (registered the package for Pi startup)

## Behavioral Impact

Agents can use `web_search` against the default local SearXNG endpoint at `http://127.0.0.1:8888` and `web_fetch` to retrieve pages as readable text, simple Markdown, HTML/raw text, or metadata-only structured output after Pi reloads its package list.

## Specification Impact

none — no existing living specification owns general web-search extension behavior in this repository.

## Risks

HTML readability extraction is dependency-free and intentionally simple, so complex pages may need `format: "html"` or targeted follow-up fetching for exact markup.

## Follow-up Items

- Run `/reload` (or restart Pi) so the newly registered package is loaded in the active session.
