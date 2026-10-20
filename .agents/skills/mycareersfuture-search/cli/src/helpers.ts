// Data source: MyCareersFuture's public v2 REST API (Workforce Singapore).
// https://api.mycareersfuture.gov.sg/v2/jobs — no authentication, JSON in/out.
//
// Verified against live responses on 2026-10-20. Two properties of this API are
// load-bearing for the CLI and are easy to get wrong:
//
//   1. It ignores unknown query parameters and still answers 200. Passing
//      `postedDate=7` or `category=11` filters nothing and raises no error, so
//      a typo'd filter looks exactly like a filter that matched everything.
//      Only `search`, `limit`, `page`, `salary` and `sortBy` were observed to
//      change the response; everything else is filtered client-side here.
//   2. There is no posting-age parameter at all. `--jobage` is therefore applied
//      client-side against metadata.newPostingDate, which every result carries.
//
// `salary` is a server-side minimum: it matches postings whose salary *range
// reaches* the value, so a S$5,000 filter still returns a S$3,800–6,500 posting.

export const API_BASE = "https://api.mycareersfuture.gov.sg/v2"
export const JOB_WEB_BASE = "https://www.mycareersfuture.gov.sg/job"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; mycareersfuture-search-cli/1.0)"

/** Maximum page size the API honours. `limit=500` returns no `results` key. */
export const MAX_LIMIT = 100

/** Fetch JSON with exponential backoff on 429/5xx. Returns null on 404. */
export async function jsonFetch(url: string): Promise<unknown | null> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
      },
      redirect: "follow",
      // The API is normally sub-second but cold requests have been measured at
      // 8s+, and this CLI issues several requests per search (page walking), so
      // the per-request ceiling is deliberately generous.
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
// Raw API shapes (only the fields this CLI reads)
// ---------------------------------------------------------------------------

interface RawSalary {
  minimum?: number | null
  maximum?: number | null
  type?: { id?: number; salaryType?: string } | null
}

interface RawAddress {
  block?: string | null
  street?: string | null
  building?: string | null
  floor?: string | null
  unit?: string | null
  postalCode?: string | null
  isOverseas?: boolean | null
  districts?: { id?: number; location?: string; region?: string }[] | null
}

interface RawMetadata {
  jobPostId?: string | null
  newPostingDate?: string | null
  originalPostingDate?: string | null
  expiryDate?: string | null
  totalNumberOfView?: number | null
  jobDetailsUrl?: string | null
}

export interface RawJob {
  uuid: string
  title?: string | null
  description?: string | null
  otherRequirements?: string | null
  workingHours?: string | null
  minimumYearsExperience?: number | null
  numberOfVacancies?: number | null
  ssocCode?: number | null
  ssocVersion?: string | null
  salary?: RawSalary | null
  address?: RawAddress | null
  metadata?: RawMetadata | null
  skills?: { skill?: string }[] | null
  categories?: { id?: number; category?: string }[] | null
  employmentTypes?: { id?: number; employmentType?: string }[] | null
  positionLevels?: { id?: number; position?: string }[] | null
  status?: { id?: number; jobStatus?: string } | null
  postedCompany?: { name?: string | null; uen?: string | null; description?: string | null } | null
  hiringCompany?: { name?: string | null } | null
  screeningQuestions?: unknown[] | null
}

interface RawSearchResponse {
  results?: RawJob[]
  total?: number
  countWithoutFilters?: number
}

// ---------------------------------------------------------------------------
// Normalised shapes
// ---------------------------------------------------------------------------

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  deadline: string | null
  salaryMin: number | null
  salaryMax: number | null
  salaryType: string | null
  employmentTypes: string[]
  positionLevels: string[]
  categories: string[]
  minYearsExperience: number | null
  district: string | null
  region: string | null
  postalCode: string | null
  isOpen: boolean
}

export interface JobDetail extends JobCard {
  description: string | null
  otherRequirements: string | null
  workingHours: string | null
  numberOfVacancies: number | null
  ssocCode: number | null
  skills: string[]
  screeningQuestionCount: number
  companyProfile: string | null
  companyUen: string | null
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/** ISO date (YYYY-MM-DD) for today in Singapore time (UTC+8), as an ISO string. */
export function todaySg(): string {
  const now = new Date()
  const sg = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  return sg.toISOString().slice(0, 10)
}

/** Whole days between an ISO date/datetime string and today (Singapore). */
export function daysAgo(iso: string | null | undefined): number | null {
  if (!iso) return null
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso)
  if (Number.isNaN(d.getTime())) return null
  const today = new Date(`${todaySg()}T00:00:00Z`)
  const posted = new Date(`${d.toISOString().slice(0, 10)}T00:00:00Z`)
  return Math.round((today.getTime() - posted.getTime()) / 86400000)
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null
}

function named(list: { [k: string]: unknown }[] | null | undefined, key: string): string[] {
  if (!Array.isArray(list)) return []
  return list.map((x) => str(x?.[key])).filter((x): x is string => x !== null)
}

/**
 * Human-readable location. Building name first (that is what a Singapore reader
 * recognises), then street, then the URA planning region. Postal code is kept
 * as its own field because it is the most reliable thing to map or commute-check.
 */
export function formatLocation(address: RawAddress | null | undefined): string | null {
  if (!address) return null
  const district = address.districts?.[0]
  const parts: string[] = []
  const building = str(address.building)
  const street = str(address.street)
  if (building) parts.push(building)
  else if (street) parts.push(street)
  if (district && str(district.region)) parts.push(str(district.region)!)
  if (parts.length === 0) parts.push("Singapore")
  return parts.join(", ")
}

/** MCF returns HTML in description/company-profile fields; collapse it to text. */
export function htmlToText(html: string | null | undefined): string | null {
  if (!html) return null
  const withBreaks = html
    .replace(/\s+/g, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
  const decoded = withBreaks
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&amp;/g, "&")
  return (
    decoded
      .split("\n")
      .map((line) => line.replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim() || null
  )
}

export function toCard(job: RawJob): JobCard {
  const address = job.address ?? null
  const district = address?.districts?.[0] ?? null
  const salary = job.salary ?? null
  const meta = job.metadata ?? null
  const company = str(job.postedCompany?.name) ?? str(job.hiringCompany?.name)

  return {
    id: job.uuid,
    title: str(job.title) ?? "(untitled)",
    company,
    location: formatLocation(address),
    date: str(meta?.newPostingDate) ?? str(meta?.originalPostingDate),
    // metadata.jobDetailsUrl is the canonical public URL. The short /job/<uuid>
    // form also resolves, and is the fallback when the field is absent.
    url: str(meta?.jobDetailsUrl) ?? `${JOB_WEB_BASE}/${job.uuid}`,
    deadline: str(meta?.expiryDate),
    salaryMin: num(salary?.minimum),
    salaryMax: num(salary?.maximum),
    salaryType: str(salary?.type?.salaryType),
    employmentTypes: named(job.employmentTypes, "employmentType"),
    positionLevels: named(job.positionLevels, "position"),
    categories: named(job.categories, "category"),
    minYearsExperience: num(job.minimumYearsExperience),
    district: str(district?.location),
    region: str(district?.region),
    postalCode: str(address?.postalCode),
    // MCF uses more than one live status: `Open` (id 102) and `Re-open` (id 103,
    // a reposted role) both mean the posting accepts applications. An exact
    // match on "open" would silently drop every Re-open posting, so match on
    // the substring instead. Closed/rejected statuses never contain "open".
    isOpen: /open/i.test(str(job.status?.jobStatus) ?? "Open"),
  }
}

export function toDetail(job: RawJob): JobDetail {
  return {
    ...toCard(job),
    description: htmlToText(job.description),
    otherRequirements: htmlToText(job.otherRequirements),
    workingHours: str(job.workingHours),
    numberOfVacancies: num(job.numberOfVacancies),
    ssocCode: num(job.ssocCode),
    skills: named(job.skills, "skill"),
    screeningQuestionCount: Array.isArray(job.screeningQuestions) ? job.screeningQuestions.length : 0,
    companyProfile: htmlToText(job.postedCompany?.description),
    companyUen: str(job.postedCompany?.uen),
  }
}

export function parseSearchResponse(raw: unknown): { jobs: JobCard[]; total: number } {
  const data = (raw ?? {}) as RawSearchResponse
  const jobs = Array.isArray(data.results) ? data.results.map(toCard) : []
  return { jobs, total: num(data.total) ?? jobs.length }
}

/**
 * Accept a raw uuid, a public job URL (any mycareersfuture.gov.sg host), or the
 * `jobDetailsUrl` slug form. A URL on any other host is rejected rather than
 * mined for a hex string, so a pasted Greenhouse/Lever link cannot silently
 * resolve to an unrelated MCF posting.
 */
export function normalizeId(input: string): string | null {
  const trimmed = input.trim()
  if (/^[0-9a-f]{32}$/i.test(trimmed)) return trimmed.toLowerCase()

  const hasScheme = /^https?:\/\//i.test(trimmed)
  if (hasScheme || /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) {
    let parsed: URL
    try {
      parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`)
    } catch {
      return null
    }
    if (!/(^|\.)mycareersfuture\.gov\.sg$/i.test(parsed.hostname)) return null
    const match = parsed.pathname.match(/([0-9a-f]{32})(?:\/)?$/i)
    return match ? match[1].toLowerCase() : null
  }

  return null
}

/** Format a monthly SGD salary range for display. */
export function formatSalary(min: number | null, max: number | null, type: string | null): string {
  if (min === null && max === null) return "—"
  const unit = (type ?? "Monthly").toLowerCase() === "monthly" ? "/mo" : ""
  if (min !== null && max !== null) {
    return min === max ? `S$${min.toLocaleString("en-SG")}${unit}` : `S$${min.toLocaleString("en-SG")}–${max.toLocaleString("en-SG")}${unit}`
  }
  const only = min ?? max
  return `S$${only!.toLocaleString("en-SG")}${unit}`
}
