import {
  API_BASE,
  MAX_LIMIT,
  daysAgo,
  formatSalary,
  jsonFetch,
  parseSearchResponse,
  writeError,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  location?: string
  jobage: number
  minSalary?: number
  sort: "newest" | "relevance"
  page: number
  limit?: number
  includeExpired: boolean
  format: "json" | "table" | "plain"
}

/**
 * Build the API URL. Only `search`, `limit`, `page`, `salary` and `sortBy` are
 * sent — the API silently ignores anything else, so sending a guessed filter
 * name would quietly return unfiltered results.
 */
export function buildUrl(opts: {
  query?: string
  minSalary?: number
  sort: "newest" | "relevance"
  page: number
  limit: number
}): string {
  const params = new URLSearchParams()
  if (opts.query) params.set("search", opts.query)
  if (opts.minSalary !== undefined) params.set("salary", String(opts.minSalary))
  // `sortBy` accepts exactly one value: `new_posting_date`. Anything else
  // (closing_date, salary, relevance) returns HTTP 400, so relevance is the
  // API's own default and is expressed by omitting the parameter.
  if (opts.sort === "newest") params.set("sortBy", "new_posting_date")
  params.set("limit", String(opts.limit))
  params.set("page", String(opts.page))
  return `${API_BASE}/jobs?${params.toString()}`
}

/** Case-insensitive substring match against district, region, postal code, or location text. */
export function matchesLocation(job: JobCard, needle: string): boolean {
  const haystack = [job.location, job.district, job.region, job.postalCode]
    .filter((v): v is string => typeof v === "string")
    .join(" ")
    .toLowerCase()
  return haystack.includes(needle.toLowerCase())
}

/**
 * Posting-age and location are both client-side (the API supports neither), so a
 * single page can be entirely filtered out. Walk forward until `limit` survivors
 * are collected, the result set is exhausted, or — because results are sorted
 * newest-first — a whole page falls entirely outside the age window.
 */
export async function collect(opts: SearchOpts): Promise<{ jobs: JobCard[]; total: number; expiredDropped: number }> {
  const want = opts.limit ?? 20
  const pageSize = Math.min(MAX_LIMIT, Math.max(want * 3, 20))
  const jobs: JobCard[] = []
  let total = 0
  let expiredDropped = 0
  let page = opts.page
  let fetched = 0
  const maxPages = 20

  for (let i = 0; i < maxPages; i++) {
    const raw = await jsonFetch(
      buildUrl({ query: opts.query, minSalary: opts.minSalary, sort: opts.sort, page, limit: pageSize }),
    )
    if (raw === null) break
    const parsed = parseSearchResponse(raw)
    total = parsed.total
    if (parsed.jobs.length === 0) break
    fetched += parsed.jobs.length

    let inWindow = 0
    for (const job of parsed.jobs) {
      const age = daysAgo(job.date)
      if (opts.jobage < 9999 && age !== null && age > opts.jobage) continue
      if (opts.jobage < 9999) inWindow++
      if (opts.location && !matchesLocation(job, opts.location)) continue
      if (!opts.includeExpired) {
        if (!job.isOpen) {
          expiredDropped++
          continue
        }
        if (job.deadline && job.deadline < new Date().toISOString().slice(0, 10)) {
          expiredDropped++
          continue
        }
      }
      if (jobs.some((j) => j.id === job.id)) continue
      jobs.push(job)
      if (jobs.length >= want) break
    }

    if (jobs.length >= want) break
    // Stop at the end of the result set. Without this a narrow query whose
    // filters reject most postings would keep walking pages until the 20-page
    // ceiling, spending 20 API calls to prove there is nothing left.
    if (parsed.jobs.length < pageSize) break
    if (total > 0 && fetched >= total) break
    // Newest-first ordering means once an entire page predates the window,
    // every later page does too.
    if (opts.jobage < 9999 && opts.sort === "newest" && inWindow === 0) break
    page++
  }

  return { jobs, total, expiredDropped }
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  // The ID column carries the full 32-character uuid on purpose. Truncating it
  // for width makes `detail <id>` fail on anything copied out of this table,
  // which is the one thing the column exists for.
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 38).padEnd(38)
    const company = (c.company || "—").slice(0, 22).padEnd(22)
    const loc = (c.location || "—").slice(0, 20).padEnd(20)
    const sal = formatSalary(c.salaryMin, c.salaryMax, c.salaryType).padEnd(17)
    return `${title} ${company} ${loc} ${sal} ${c.date || "—"}  ${c.id}`
  })
  const header =
    "TITLE".padEnd(38) + " " + "COMPANY".padEnd(22) + " " + "LOCATION".padEnd(20) + " " + "SALARY".padEnd(17) + " POSTED      ID"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const { jobs, total, expiredDropped } = await collect(opts)

    if (opts.format === "table") {
      process.stdout.write(renderTable(jobs) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        jobs
          .map(
            (c) =>
              `${c.title}\n  ${c.company || "—"} · ${c.location || "—"}\n  ${formatSalary(c.salaryMin, c.salaryMax, c.salaryType)} · posted ${c.date || "—"} · closes ${c.deadline || "—"}\n  id: ${c.id}\n  ${c.url}`,
          )
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify(
          {
            meta: { count: jobs.length, page: opts.page, total, expiredDropped },
            results: jobs,
          },
          null,
          2,
        ) + "\n",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
