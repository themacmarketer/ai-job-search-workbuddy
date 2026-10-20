# mycareersfuture-cli

CLI for searching Singapore job listings on **MyCareersFuture**, the Workforce
Singapore (WSG) government job portal.

**Data source**: public `https://api.mycareersfuture.gov.sg/v2` REST API.
**Authentication**: none required.
**Dependencies**: none (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

MyCareersFuture is a public government service. Its `robots.txt` allows all paths
for generic user agents. The CLI sends an honest user agent that names itself —
please keep request volume reasonable, since it is a shared public service.

## Installation

```bash
cd .agents/skills/mycareersfuture-search/cli
bun install   # optional — only installs TypeScript dev types
```

The CLI runs without any install because it has zero runtime dependencies.

## Commands

| Command | Description |
|---|---|
| `search` | Find postings by keyword, with optional location, recency and salary filters |
| `detail` | Fetch one posting's full description, requirements, skills and company profile |

### `search`

```bash
bun run src/cli.ts search --query "software engineer" --jobage 14 --format table
```

| Flag | Default | Notes |
|---|---|---|
| `--query`, `-q` | — | Keywords: title, skill, or company |
| `--location`, `-l` | — | District, region, or postal code. **Client-side** |
| `--jobage` | all | Posted within N days. **Client-side** |
| `--min-salary` | — | Monthly gross SGD. Server-side, but matches ranges that *reach* the value |
| `--sort` | `newest` | `newest` \| `relevance` |
| `--page` | `0` | **0-indexed**, the API's own convention |
| `--limit`, `-n` | `20` | Max 100 |
| `--include-expired` | off | Keep closed or past-deadline postings |
| `--format` | `json` | `json` \| `table` \| `plain` |

### `detail`

```bash
bun run src/cli.ts detail 74bd2c1381896351e2bae40356b362ea --format plain
```

Accepts a 32-character uuid or a `mycareersfuture.gov.sg` job URL. Any other host
is rejected with `BAD_ID`.

## Output

`search --format json` emits:

```json
{ "meta": { "count": 3, "page": 0, "total": 534, "expiredDropped": 2 },
  "results": [ { "id": "...", "title": "...", "company": "...", "location": "...",
                 "date": "...", "url": "...", "deadline": "...",
                 "salaryMin": 5000, "salaryMax": 8000, "salaryType": "Monthly", ... } ] }
```

Errors go to **stderr** as `{ "error": "...", "code": "..." }` with exit code 1.

## Why this CLI is deliberately strict

The API **ignores unknown query parameters and still returns HTTP 200**. A
misspelled or invented filter therefore returns an unfiltered result set that is
indistinguishable from a successful search. Two consequences are baked into the
code:

- Only `search`, `limit`, `page`, `salary` and `sortBy` are ever sent.
- Unknown CLI flags are **rejected**, not dropped — see `cli-flag-validation.test.ts`.

There is also no posting-age parameter, so `--jobage` and `--location` are applied
client-side, and the CLI pages forward until it has enough survivors.

## Tests

```bash
bun test        # 71 tests, network-free (captured fixtures + local server)
bun run typecheck
```

`tests/fixtures/search.json` and `detail.json` are trimmed real responses captured
on 2026-10-20. If the portal changes a field path, the parsing tests fail — which
is the point of using captured data rather than hand-written JSON.

## Quirks worth knowing

- `jobStatus` has at least two live values: `Open` (id 102) and `Re-open` (id 103).
  Treating only `Open` as live silently drops reposted roles.
- `sortBy` accepts exactly one value, `new_posting_date`; anything else is HTTP 400.
- `limit` above 100 returns a body with no `results` key at all.
- `salary` is a floor on the *range*, not on the minimum: a S$5,000 filter returns
  a S$3,800–6,500 posting.
