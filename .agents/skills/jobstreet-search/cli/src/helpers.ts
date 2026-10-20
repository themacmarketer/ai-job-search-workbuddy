// Data source: JobStreet Singapore (SEEK) public search API.
// https://sg.jobstreet.com/api/jobsearch/v5/search
//
// IMPORTANT — read before changing anything here:
// JobStreet's robots.txt disallows `/api/jobsearch/` for generic user agents and
// names several AI crawlers for a full disallow. This CLI therefore ships with
// `enabled: false` in SKILL.md: it is opt-in, personal-use only, and the user
// turns it on deliberately. Keep request volume low.
//
// Verified against live responses on 2026-10-20:
//   - www.jobstreet.com.sg 308-redirects to sg.jobstreet.com; call the latter.
//   - `daterange` is a real SERVER-SIDE recency filter, accepted values 1/7/14/31.
//   - `where` is a real SERVER-SIDE location filter.
//   - `pagesize` caps at 100 (200 returns a body with no `data` key).
//   - `page` is 1-indexed.
//   - `jobid=<id>` turns the search endpoint into a by-id lookup (totalCount: 1).
//   - The posting page itself is Cloudflare-gated (HTTP 403 "Just a moment..."),
//     so a full description is NOT available to this CLI. Only `teaser` and
//     `bulletPoints` are. `detail` says so rather than pretending otherwise.

export const API_BASE = "https://sg.jobstreet.com/api/jobsearch/v5/search"
export const JOB_WEB_BASE = "https://sg.jobstreet.com/job"
export const MAX_LIMIT = 100

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; jobstreet-search-cli/1.0)"

export async function jsonFetch(url: string): Promise<unknown | null> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      redirect: "follow",
      signal: AbortSignal.timeout(30000),
    })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Request failed: ${response.status} ${response.statusText}`)
      }
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((r) => setTimeout(r, delay + jitter))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    return (await response.json()) as unknown
  }
  throw new Error("Request failed after max retries")
}

// ---------------------------------------------------------------------------
// Raw shapes
// ---------------------------------------------------------------------------

export interface RawJob {
  id: string
  title?: string | null
  advertiser?: { id?: string; description?: string | null } | null
  companyName?: string | null
  locations?: { label?: string; countryCode?: string }[] | null
  listingDate?: string | null
  listingDateDisplay?: string | null
  salaryLabel?: string | null
  workTypes?: string[] | null
  workArrangements?: { data?: { id?: string; label?: { text?: string } }[] } | null
  classifications?: {
    classification?: { id?: string; description?: string } | null
    subclassification?: { id?: string; description?: string } | null
  }[] | null
  bulletPoints?: string[] | null
  teaser?: string | null
  tags?: { type?: string; label?: string }[] | null
  isFeatured?: boolean | null
}

interface RawSearchResponse {
  data?: RawJob[]
  totalCount?: number
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  salaryLabel: string | null
  salaryMin: number | null
  salaryMax: number | null
  workTypes: string[]
  workArrangement: string | null
  classification: string | null
  subclassification: string | null
  teaser: string | null
}

export interface JobDetail extends JobCard {
  bulletPoints: string[]
  tags: string[]
  /** Always null: the posting page is Cloudflare-gated. */
  description: null
  descriptionAvailable: false
  descriptionNote: string
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null
}

/**
 * Parse a SEEK `salaryLabel` into a monthly SGD range.
 *
 * The label is free text and appears in several shapes:
 *   "$5,000 – $6,000 per month"
 *   "From $4,000 per month"
 *   "Up to $8,000 per month"
 *   "Negotiable"
 * Only the first two numbers are read. A label with one number is treated as a
 * floor when it follows "From"/"$X and above", and as a ceiling after "Up to".
 */
export function parseSalaryLabel(label: string | null): { min: number | null; max: number | null } {
  if (!label) return { min: null, max: null }
  const numbers = [...label.matchAll(/(\d[\d,]*)/g)].map((m) => Number(m[1].replace(/,/g, "")))
  if (numbers.length === 0) return { min: null, max: null }
  const isCeiling = /^\s*up to/i.test(label)
  const isFloor = /^\s*from/i.test(label) || /and above/i.test(label)
  if (numbers.length === 1) {
    return isCeiling ? { min: null, max: numbers[0] } : isFloor ? { min: numbers[0], max: null } : { min: numbers[0], max: numbers[0] }
  }
  return { min: numbers[0], max: numbers[1] }
}

export function toCard(job: RawJob): JobCard {
  const salary = parseSalaryLabel(str(job.salaryLabel))
  const location = job.locations?.[0]?.label ?? null
  const arrangement = job.workArrangements?.data?.[0]?.label?.text ?? null
  const cls = job.classifications?.[0] ?? null
  return {
    id: job.id,
    title: str(job.title) ?? "(untitled)",
    company: str(job.advertiser?.description) ?? str(job.companyName),
    location: str(location),
    // listingDate is a full ISO datetime; the framework's contract wants a date.
    date: str(job.listingDate)?.slice(0, 10) ?? null,
    url: `${JOB_WEB_BASE}/${job.id}`,
    salaryLabel: str(job.salaryLabel),
    salaryMin: salary.min,
    salaryMax: salary.max,
    workTypes: Array.isArray(job.workTypes) ? job.workTypes.filter((w) => typeof w === "string") : [],
    workArrangement: str(arrangement),
    classification: str(cls?.classification?.description),
    subclassification: str(cls?.subclassification?.description),
    teaser: str(job.teaser),
  }
}

export function toDetail(job: RawJob): JobDetail {
  return {
    ...toCard(job),
    bulletPoints: Array.isArray(job.bulletPoints) ? job.bulletPoints.filter((b) => typeof b === "string") : [],
    tags: Array.isArray(job.tags) ? job.tags.map((t) => str(t.label)).filter((t): t is string => !!t) : [],
    description: null,
    descriptionAvailable: false,
    descriptionNote:
      "JobStreet serves the posting page behind a Cloudflare challenge (HTTP 403), so the full description is not retrievable by this CLI. Open the url, or paste the posting text into /apply directly.",
  }
}

export function parseSearchResponse(raw: unknown): { jobs: JobCard[]; total: number } {
  const data = (raw ?? {}) as RawSearchResponse
  const jobs = Array.isArray(data.data) ? data.data.map(toCard) : []
  return { jobs, total: typeof data.totalCount === "number" ? data.totalCount : jobs.length }
}

/**
 * Accept a numeric job id, or a sg.jobstreet.com / jobstreet.com.sg job URL.
 * Any other host is rejected rather than mined for digits.
 */
export function normalizeId(input: string): string | null {
  const trimmed = input.trim()
  if (/^\d{6,}$/.test(trimmed)) return trimmed

  const hasScheme = /^https?:\/\//i.test(trimmed)
  if (hasScheme || /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) {
    let parsed: URL
    try {
      parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`)
    } catch {
      return null
    }
    if (!/(^|\.)(sg\.)?jobstreet\.com(\.sg)?$/i.test(parsed.hostname)) return null
    const match = parsed.pathname.match(/\/job\/(\d{6,})(?:\/)?$/)
    return match ? match[1] : null
  }

  return null
}

/** Map a day count onto the portal's discrete recency buckets. */
export function daterangeFor(days: number): string | null {
  if (!Number.isFinite(days) || days < 1) return null
  if (days <= 1) return "1"
  if (days <= 7) return "7"
  if (days <= 14) return "14"
  if (days <= 31) return "31"
  return null
}

export function daysAgo(iso: string | null | undefined): number | null {
  if (!iso) return null
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso)
  if (Number.isNaN(d.getTime())) return null
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000)
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`)
  const posted = new Date(`${d.toISOString().slice(0, 10)}T00:00:00Z`)
  return Math.round((today.getTime() - posted.getTime()) / 86400000)
}
