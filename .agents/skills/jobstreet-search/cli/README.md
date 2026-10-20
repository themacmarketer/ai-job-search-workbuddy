# jobstreet-cli

CLI for searching Singapore job listings on **JobStreet** (SEEK).

> ## ⚠️ Personal use only — and off by default
>
> JobStreet's `robots.txt` disallows `/api/jobsearch/`, which is the endpoint this CLI
> calls, and separately disallows several AI crawlers by name. The skill ships with
> `enabled: false` for that reason.
>
> If you turn it on: personal, low-volume use only. A few searches per session, not a
> crawl. No commercial or bulk use.
>
> A no-code alternative already works: `/scrape` falls back to `WebSearch` with
> `site:sg.jobstreet.com` queries, which reaches the same postings legitimately.

**Data source**: `https://sg.jobstreet.com/api/jobsearch/v5/search` (public, no auth).
**Dependencies**: none (plain `bun` + `fetch`).

## What it returns — and what it can't

Search results carry the title, company, location, posting date, work type, job
category and salary label. The **full job description is not available**: posting pages
are served behind a Cloudflare challenge (HTTP 403), and no reachable per-job JSON
endpoint exists.

So this portal is good for discovery, not for `/apply`. For a real application, open the
posting URL and paste the text into `/apply`, which accepts pasted descriptions.

## Commands

```bash
bun run src/cli.ts search --query "software engineer" --jobage 7 --format table
bun run src/cli.ts detail 95372516 --format plain
```

| Flag | Default | Notes |
|---|---|---|
| `--query`, `-q` | — | Keywords |
| `--location`, `-l` | — | Server-side `where`: `"Jurong East"`, `"Central Region"` |
| `--jobage` | all | Server-side `daterange` bucket (1/7/14/31) + client-side backstop |
| `--sort` | portal default | `ListedDate` \| `KeywordRelevance` |
| `--page` | `1` | **1-indexed** |
| `--limit`, `-n` | `20` | Max 100 |
| `--format` | `json` | `json` \| `table` \| `plain` |

## Tests

```bash
bun test        # 34 tests, network-free
bun run typecheck
```

`tests/fixtures/search.json` is a trimmed real response captured 2026-10-20.

## Quirks

- `www.jobstreet.com.sg` 308-redirects to `sg.jobstreet.com`. Following the redirect on
  an API call drops the query string and returns **Australian** jobs — call the
  canonical host directly.
- `pagesize` above 100 returns a body with no `data` key.
- `daterange` accepts only 1/7/14/31; wider windows are filtered client-side.
- `where` is fuzzy.
- `salaryLabel` is free text; the CLI parses the first two numbers and keeps the label.
