# JobStreet Singapore — endpoint reference

Maintainer notes for `.agents/skills/jobstreet-search`. Verified against live responses
on **2026-10-20**.

## Access constraints (read first)

`https://sg.jobstreet.com/robots.txt`, for `User-agent: *`:

```
Disallow: */job/*?*type=
Disallow: *?
Disallow: /graphql
Disallow: /api/jobsearch/
```

Separate blocks fully disallow `anthropic-ai`, `GPTBot`, `CCBot`, `Bytespider`,
`Google-Extended`, `Diffbot`, `omgili`, and `PetalBot`.

`/api/jobsearch/` is the endpoint this CLI uses. The skill therefore ships with
`enabled: false`. Do not flip it on in a shared or automated context.

## Hosts

| Purpose | URL |
|---|---|
| Canonical host | `https://sg.jobstreet.com` |
| Legacy host | `https://www.jobstreet.com.sg` → **308 redirect** to `sg.jobstreet.com` |
| Search API | `https://sg.jobstreet.com/api/jobsearch/v5/search` |
| Posting page | `https://sg.jobstreet.com/job/<id>` — **Cloudflare challenge, HTTP 403** |

Calling the legacy host's API path returns a 308 to the bare `.../api/jobsearch/v5/search`
with no query string, which silently loses `siteKey` and returns **Australian** jobs.
Always call `sg.jobstreet.com` directly.

## Search parameters

| Parameter | Behaviour | Notes |
|---|---|---|
| `siteKey` | required | `SG-Main` |
| `sourcesystem` | required | `houston` |
| `keywords` | free text | title, skill, company |
| `where` | location | server-side; fuzzy — `"Jurong East"` matches broadly |
| `daterange` | recency | **server-side**; only `1`, `7`, `14`, `31` |
| `sortmode` | sort | `ListedDate`, `KeywordRelevance` |
| `page` | pagination | **1-indexed** |
| `pagesize` | page size | **max 100**; `200` returns a body with no `data` key |
| `jobid` | by-id lookup | returns `totalCount: 1` for that posting |

Observed totals for `keywords=software engineer`: 5119 unfiltered; `daterange=1` → 59,
`7` → 1133, `14` → 2119, `31` → 3683.

## Search response

```json
{ "data": [ /* job objects */ ], "totalCount": 5119,
  "info": {...}, "sortModes": [...], "solMetadata": {...},
  "facets": {...}, "searchParams": {...} }
```

## Job object (fields the CLI reads)

| Field | Used as |
|---|---|
| `id` (string) | `id` |
| `title` | `title` |
| `advertiser.description` | `company` |
| `companyName` | fallback for `company` |
| `locations[0].label` | `location` (e.g. `Macpherson, Central Region`) |
| `locations[0].countryCode` | not surfaced — `SG` on Singapore results |
| `listingDate` (ISO datetime) | `date` (truncated to `YYYY-MM-DD`) |
| `listingDateDisplay` | not surfaced (relative text like `33m ago`) |
| `salaryLabel` | `salaryLabel`, parsed into `salaryMin`/`salaryMax` |
| `workTypes[]` | `workTypes` (`["Full time"]`) |
| `workArrangements.data[0].label.text` | `workArrangement` (`On-site`, `Hybrid`, `Remote`) |
| `classifications[0].classification.description` | `classification` |
| `classifications[0].subclassification.description` | `subclassification` |
| `teaser` | `teaser` — the only prose available |
| `bulletPoints[]` | `detail.bulletPoints` |
| `tags[].label` | `detail.tags` (`Be an early applicant`, …) |
| `isFeatured`, `branding`, `tracking`, `solMetadata` | unused |

## What is not reachable

- `GET /job/<id>` → HTTP 403, Cloudflare "Just a moment..." interstitial, even with full browser headers.
- `GET /api/jobsearch/v5/jobs/<id>` → 404
- `GET /api/jobsearch/v5/job/<id>` → 404
- `GET /api/jobdetail/v1/jobs/<id>` → 404

`search?jobid=<id>` is the only working by-id path. It returns listing metadata and a
teaser, never the full description. `detail` reports `descriptionAvailable: false`
rather than implying the field is empty because the posting is thin.

## Salary label formats seen

```
$5,000 – $6,000 per month     -> { min: 5000, max: 6000 }
$4,500 per month              -> { min: 4500, max: 4500 }
From $4,000 per month         -> { min: 4000, max: null }
Up to $8,000 per month        -> { min: null, max: 8000 }
Negotiable / absent           -> { min: null, max: null }
```
