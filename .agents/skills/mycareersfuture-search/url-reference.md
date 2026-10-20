# MyCareersFuture — endpoint reference

Maintainer notes for `.agents/skills/mycareersfuture-search`. Verified against live
responses on **2026-10-20**. Update the anchors here if the portal changes; the CLI's
parsers in `cli/src/helpers.ts` read exactly the field paths listed below.

## Hosts

| Purpose | URL |
|---|---|
| Public web UI | `https://www.mycareersfuture.gov.sg` |
| REST API | `https://api.mycareersfuture.gov.sg/v2` |
| Short job URL | `https://www.mycareersfuture.gov.sg/job/<uuid>` (resolves, HTTP 200) |
| Canonical job URL | `metadata.jobDetailsUrl`, e.g. `https://www.mycareersfuture.gov.sg/job/general-management/marketing-manager-ehplabs-singapore-<uuid>` |

`robots.txt` on `www` returns `User-agent: *` / `Disallow:` (empty — everything
allowed), with a separate `Disallow: /` only for `meta-externalagent`. The API host
returns no robots.txt (`Cannot GET /robots.txt`), which is not a disallow.

## Access

No authentication, no API key, no cookies. Send an honest UA — the CLI uses
`Mozilla/5.0 (compatible; mycareersfuture-search-cli/1.0)`.

## Search

```
GET https://api.mycareersfuture.gov.sg/v2/jobs?search=<q>&limit=<n>&page=<n>&sortBy=new_posting_date&salary=<min>
```

| Parameter | Behaviour | Notes |
|---|---|---|
| `search` | keyword match on title/skill/company | free text |
| `limit` | page size | **max 100** — `limit=500` returns a body with no `results` key |
| `page` | page number | **0-indexed**; `page=0` is the first page |
| `salary` | minimum monthly gross SGD | matches postings whose range *reaches* the value, not a strict floor |
| `sortBy` | sort order | **only `new_posting_date` is accepted**; `closing_date`, `salary`, `relevance` all return HTTP 400 |

### Parameters that do NOT exist

Verified by comparing `total` across requests on the same query. All of the following
return HTTP 200 and change nothing — the API ignores unknown parameters:

`postedDate`, `datePosted`, `posted`, `employmentType`, `positionLevel`, `category`,
`orderBy`, `district`, `region`.

This is the single most important quirk for a maintainer: **a guessed filter name
fails silently and looks like it worked.** The CLI applies recency and location
client-side and sends only the five supported parameters.

## Search response

```json
{
  "results": [ /* job objects */ ],
  "total": 534,
  "countWithoutFilters": 534,
  "_links": { "self": {...}, "next": {...}, "first": {...}, "last": {...} }
}
```

`total` counts the keyword match *before* client-side filtering.

## Job object (fields the CLI reads)

| Field path | Type | Used as |
|---|---|---|
| `uuid` | string (32 hex) | `id` |
| `title` | string | `title` |
| `description` | HTML string | `detail.description` (tags stripped) |
| `otherRequirements` | HTML string \| null | `detail.otherRequirements` |
| `workingHours` | string \| null | `detail.workingHours` |
| `minimumYearsExperience` | number \| null | `minYearsExperience` |
| `numberOfVacancies` | number \| null | `detail.numberOfVacancies` |
| `ssocCode` | number | `detail.ssocCode` |
| `salary.minimum` | number \| null | `salaryMin` (monthly gross SGD) |
| `salary.maximum` | number \| null | `salaryMax` |
| `salary.type.salaryType` | string | `salaryType` (observed: `Monthly`) |
| `address.building` | string \| null | part of `location` |
| `address.street` | string \| null | fallback for `location` |
| `address.postalCode` | string \| null | `postalCode` |
| `address.districts[0].location` | string | `district` (e.g. `D20 Ang Mo Kio, Bishan`) |
| `address.districts[0].region` | string | `region` (e.g. `Central`, `West`) |
| `metadata.newPostingDate` | `YYYY-MM-DD` | `date` |
| `metadata.originalPostingDate` | `YYYY-MM-DD` | fallback for `date` |
| `metadata.expiryDate` | `YYYY-MM-DD` | `deadline` |
| `metadata.jobDetailsUrl` | string | `url` |
| `metadata.jobPostId` | string | not surfaced (internal id) |
| `status.jobStatus` | string | `isOpen` (`"Open"` → true) |
| `postedCompany.name` | string | `company` |
| `postedCompany.uen` | string | `detail.companyUen` |
| `postedCompany.description` | HTML string | `detail.companyProfile` |
| `postedCompany.ssicCode` / `employeeCount` | | not surfaced — useful for company-size context if ever needed |
| `hiringCompany.name` | string \| null | fallback for `company` |
| `skills[].skill` | string | `detail.skills` |
| `categories[].category` | string | `categories` |
| `employmentTypes[].employmentType` | string | `employmentTypes` |
| `positionLevels[].position` | string | `positionLevels` |

## Detail

```
GET https://api.mycareersfuture.gov.sg/v2/jobs/<uuid>
```

Returns the same object plus `screeningQuestions` (an array — the CLI reports only its
length, since the questions are answered in the MCF web flow, not in a generated
document). `404` for an unknown uuid.

Also available but unused: `_links.screeningQuestions.href`
(`/v2/jobs/<uuid>/screening-questions`).

## URL forms accepted by `detail`

- bare 32-hex uuid
- `https://www.mycareersfuture.gov.sg/job/<uuid>`
- `https://www.mycareersfuture.gov.sg/job/<category-slug>/<title-slug>-<uuid>`

Any other host is rejected with `BAD_ID`. The uuid is matched as the final path
segment, so a trailing slash is tolerated.
