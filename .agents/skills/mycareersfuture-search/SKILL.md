---
name: mycareersfuture-search
version: 1.0.0
description: >
  Make sure to use this skill whenever the user wants to search for jobs in Singapore,
  find Singapore job listings, look up a specific Singapore job posting, or asks anything
  about the Singapore job market — even if they don't mention MyCareersFuture explicitly.
  Invoke this skill for questions about open positions, job vacancies, hiring in Singapore,
  job opportunities in Singapore districts or sectors, or when the user wants to find work
  in Singapore. Also trigger for phrases like "find me a job in Singapore", "are there any
  jobs for X in Singapore", or "what jobs are available in Jurong / Tampines / one-north"
  when the context is Singapore. Trigger phrases include: mycareersfuture, mcf, jobs in
  singapore, singapore jobs, sg jobs, job search singapore, find work singapore, work in
  singapore, singapore job vacancy, job openings singapore, hiring singapore, job listings
  singapore, WSG, Workforce Singapore, jobs near me singapore, EP jobs singapore,
  employment pass jobs singapore, software engineer jobs singapore, marketing jobs
  singapore, finance jobs singapore, jobs central region singapore.
context: fork
enabled: true
allowed-tools: Bash(bun run .agents/skills/mycareersfuture-search/cli/src/cli.ts *)
---

# MyCareersFuture Search Skill

Search live Singapore job listings from **MyCareersFuture**, the Workforce Singapore
(WSG) government job portal. No authentication needed.

This is the primary Singapore job source for three reasons:

1. **It is the only board with reliable salary data.** Every posting carries a monthly
   gross SGD range, because employers must declare one. That makes salary benchmarking
   possible without a third-party dataset.
2. **It is where Employment Pass / S Pass jobs must be advertised.** Under the Fair
   Consideration Framework, employers submitting EP or S Pass applications must first
   advertise the role on MyCareersFuture for at least 14 consecutive days. A live MCF
   posting from a company that hires foreign talent is therefore a genuinely useful
   signal, and many postings state their sponsorship position outright.
3. **Every result carries a posting date and an expiry date**, so freshness and
   deadlines are facts rather than guesses.

## When to use this skill

Invoke this skill when the user wants to:

- Search for job openings in Singapore by keyword, job title, or skill
- Find jobs in a specific district or region (Jurong, Tampines, Central, one-north, …)
- Filter by minimum salary or by recency
- Get the full description, requirements, and skills of a specific posting
- Explore the Singapore market for a given profession or skill set

## Commands

### Search job listings

```bash
bun run .agents/skills/mycareersfuture-search/cli/src/cli.ts search --query "<text>" [flags]
```

Key flags:

- `--query <text>` / `-q <text>` — keyword search (job title, skill, company). Recommended; omitting it returns the whole board.
- `--location <text>` / `-l <text>` — filter by district, region, or postal code. **Applied client-side** — the API has no location parameter. See the area note below.
- `--jobage <days>` — posted within N days. **Applied client-side** against each posting's date; the API has no age parameter.
- `--min-salary <n>` — minimum monthly gross salary in SGD. Server-side. The API matches postings whose range *reaches* the value, so `--min-salary 5000` can still return a S$3,800–6,500 posting. Treat it as a coarse cut, not a strict floor.
- `--sort <order>` — `newest` (default) or `relevance`.
- `--page <n>` — **0-indexed**, following the API's own convention. Every other portal CLI in this repo is 1-indexed; this one is not.
- `--limit <n>` / `-n <n>` — cap results emitted. Default 20, maximum 100 (the API's page-size ceiling).
- `--include-expired` — keep postings that are closed or past their deadline. By default they are dropped, and the count is reported in `meta.expiredDropped`.
- `--format json|table|plain`

### Fetch full job detail

```bash
bun run .agents/skills/mycareersfuture-search/cli/src/cli.ts detail <uuid|url> [--format json|plain]
```

Accepts the 32-character uuid, or a `mycareersfuture.gov.sg` job URL (including the
long slug form). Returns the full description, other requirements, working hours,
vacancy count, skill list, company profile and UEN, and a screening-question count.
A URL on any other host is rejected rather than mined for a hex string.

---

## How to use effectively

**Always start with `search`.** Pass the job title, skill, or company as `--query`.
Combine with `--jobage 14` to match the framework's default freshness window.

**Use `--format table` for scanning, `--format json` for processing.** The table
prints the full 32-character uuid in its ID column so it can be pasted straight into
`detail` — it is not truncated.

**Natural workflow: `search` → `detail`.**
1. `search` to find matching jobs and their uuids.
2. `detail <uuid>` for the full description before evaluating fit.

**Pagination.** The API is 0-indexed and caps `limit` at 100. Because `--jobage` and
`--location` are client-side, the CLI walks forward through pages itself until it has
enough survivors — you do not need to loop manually.

**Salary is monthly gross in SGD.** It excludes employer CPF contributions and any
AWS/13th-month bonus. When comparing against a benchmark, annualise as
`monthly × 13` for a typical Singapore package with AWS, and say which convention
you used.

---

## Usage examples

### Marketing manager roles posted in the last 14 days

```bash
bun run .agents/skills/mycareersfuture-search/cli/src/cli.ts search \
  --query "marketing manager" \
  --jobage 14 \
  --format table
```

### Product roles in the Central region at S$6,000+/month

```bash
bun run .agents/skills/mycareersfuture-search/cli/src/cli.ts search \
  --query "product manager" \
  --location "Central" \
  --min-salary 6000 \
  --format table
```

### Software engineer roles, newest first, JSON for processing

```bash
bun run .agents/skills/mycareersfuture-search/cli/src/cli.ts search \
  --query "software engineer" \
  --sort newest \
  --limit 40 \
  --format json
```

### Jobs near a specific postal code

```bash
bun run .agents/skills/mycareersfuture-search/cli/src/cli.ts search \
  --query "data analyst" \
  --location "138577" \
  --jobage 30 \
  --format table
```

### Full detail for one posting

```bash
bun run .agents/skills/mycareersfuture-search/cli/src/cli.ts detail \
  74bd2c1381896351e2bae40356b362ea --format plain
```

---

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, data processing, passing uuids to `detail` |
| `table` | Quick human-readable overview and scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the
process exits with code `1`.

---

## Notes

- Data comes from the public `api.mycareersfuture.gov.sg/v2` REST API — no credentials required.
- **Unknown query parameters are silently ignored by this API** and still return HTTP 200. That is why the CLI only ever sends `search`, `limit`, `page`, `salary` and `sortBy`, applies recency and location itself, and rejects unknown flags rather than dropping them. A guessed filter name would return unfiltered results that look like a successful search.
- `sortBy` accepts exactly one value, `new_posting_date`. Passing anything else returns HTTP 400, so `--sort relevance` is expressed by omitting the parameter.
- `--location` matches against the building name, street, URA planning district, region, and postal code. It is a substring match, so `"Central"` catches the Central region while `"Jurong"` catches Jurong East/West listings.
- Postings are dropped by default when their status is not `Open` or their expiry date has passed; `meta.expiredDropped` reports how many.
- `metadata.jobDetailsUrl` is used as the public URL when present (it is the canonical slug URL); otherwise the short `/job/<uuid>` form is built, which also resolves.
- MCF has no posting-age parameter, so a `--jobage` search with a narrow keyword can legitimately return fewer results than the API's `total` — `total` counts the unfiltered keyword match.
- The API is normally sub-second but cold requests have been measured at 8s+. The CLI retries on 429/5xx with exponential backoff and allows 30s per request.
