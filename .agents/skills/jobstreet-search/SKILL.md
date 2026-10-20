---
name: jobstreet-search
version: 1.0.0
description: >
  Search Singapore job listings on JobStreet (SEEK). Use when the user wants to search
  jobs on JobStreet Singapore, find a JobStreet listing, or widen a Singapore job search
  beyond MyCareersFuture. Trigger phrases include: jobstreet, jobstreet singapore,
  jobstreet.com.sg, jobs on jobstreet, sg jobstreet, jobstreet search, jobstreet listing,
  jobstreet vacancy. DISABLED BY DEFAULT — see the access notice in this file before
  enabling it.
context: fork
enabled: false  # Ships off deliberately: robots.txt disallows /api/jobsearch/. See the access notice below.
allowed-tools: Bash(bun run .agents/skills/jobstreet-search/cli/src/cli.ts *)
---

# JobStreet Singapore Search Skill

Search live Singapore job listings from **JobStreet** (SEEK), Singapore's largest
commercial job board.

## ⚠️ Access notice — read before enabling

**This skill ships disabled on purpose.** JobStreet's `robots.txt` states, for generic
user agents:

```
User-agent: *
Disallow: /api/jobsearch/
Disallow: /graphql
```

and separately disallows several AI crawlers outright (`anthropic-ai`, `GPTBot`,
`CCBot`, `Google-Extended`, `Bytespider`, `omgili`). The search API this CLI calls is
the exact path named in that `Disallow` line.

So this is not a grey area like LinkedIn's Terms of Service — it is a stated,
machine-readable instruction about this endpoint. It ships disabled so the choice is
yours and made deliberately, not something that happens quietly in the background.

**If you enable it** (`enabled: true` in the frontmatter above):

- Treat it as **personal, low-volume use only**. A handful of searches per session, not a crawl.
- Do not use it commercially or for bulk data collection.
- You are responsible for the request volume and for how the results are used.

**A compliant alternative exists and needs no code:** `/scrape` falls back to
`WebSearch` with `site:sg.jobstreet.com` queries (already configured in
`search-queries.md`), which reaches the same postings through a search engine that
indexes them with permission.

If the user has not explicitly asked for JobStreet, prefer `mycareersfuture-search`:
it is a government service whose robots.txt permits access, and it carries richer,
more reliable data (declared salary, posting date, expiry date, full description).

## What it can and cannot do

| | Available |
|---|---|
| Search by keyword, location, recency | Yes |
| Salary label (and parsed SGD range) | Yes, when the employer discloses one |
| Work type, arrangement, job category | Yes |
| Posting date | Yes |
| **Full job description** | **No** — the posting page is behind a Cloudflare challenge (HTTP 403). Only a short `teaser` and `bulletPoints` are returned. |

Because the description is unavailable, this portal is useful for **discovery**, not for
`/apply`. When a posting matters, open its URL and paste the text into `/apply`, which
accepts a pasted description directly.

## Commands

### Search

```bash
bun run .agents/skills/jobstreet-search/cli/src/cli.ts search --query "<text>" [flags]
```

| Flag | Notes |
|---|---|
| `--query <text>` / `-q` | Keywords. Recommended. |
| `--location <text>` / `-l` | Server-side `where` parameter: `"Jurong East"`, `"Central Region"`, `"Singapore"` |
| `--jobage <days>` | Server-side `daterange` bucket (1/7/14/31) plus a client-side backstop |
| `--sort <mode>` | `ListedDate` \| `KeywordRelevance` |
| `--page <n>` | **1-indexed** (MyCareersFuture is 0-indexed — do not copy flags across) |
| `--limit <n>` / `-n` | Default 20, max 100 |
| `--format` | `json` \| `table` \| `plain` |

### Detail

```bash
bun run .agents/skills/jobstreet-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

Resolves one posting through the search endpoint's `jobid` parameter. Returns the
listing metadata, salary label, teaser and highlights, and states explicitly that the
description is unavailable.

## Usage examples

```bash
# Software engineer roles posted in the last week
bun run .agents/skills/jobstreet-search/cli/src/cli.ts search \
  -q "software engineer" --jobage 7 --format table

# Marketing roles in the Central Region, last 14 days
bun run .agents/skills/jobstreet-search/cli/src/cli.ts search \
  -q "marketing" -l "Central Region" --jobage 14 --format table

# One posting, with the salary label parsed
bun run .agents/skills/jobstreet-search/cli/src/cli.ts detail 95372516 --format plain
```

## Notes

- `www.jobstreet.com.sg` 308-redirects to `sg.jobstreet.com`. The CLI calls the latter directly.
- `pagesize` caps at 100; a larger value returns a body with no `data` key.
- `jobid=<id>` turns the search endpoint into a by-id lookup (`totalCount: 1`). There is no separate reachable per-job JSON endpoint.
- `salaryLabel` is free text (`"$5,000 – $6,000 per month"`, `"From $4,000 per month"`, `"Negotiable"`). The CLI parses the first two numbers into `salaryMin`/`salaryMax` and keeps the original label.
- `where` is fuzzy — `"Jurong East"` returns a broader set than the district alone, so treat it as a soft filter.
- Errors are written to stderr as `{ "error": "...", "code": "..." }`, exit code 1.
