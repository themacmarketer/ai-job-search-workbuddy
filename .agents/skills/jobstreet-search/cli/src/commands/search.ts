import {
  API_BASE,
  MAX_LIMIT,
  daterangeFor,
  daysAgo,
  jsonFetch,
  parseSearchResponse,
  writeError,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  location?: string
  jobage: number
  sort?: string
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

export function buildUrl(opts: {
  query?: string
  location?: string
  jobage: number
  sort?: string
  page: number
  limit: number
}): string {
  const params = new URLSearchParams()
  params.set("siteKey", "SG-Main")
  params.set("sourcesystem", "houston")
  if (opts.query) params.set("keywords", opts.query)
  if (opts.location) params.set("where", opts.location)
  // daterange is a genuine server-side filter, so it is always sent when the
  // requested window maps onto one of its buckets. A window wider than 31 days
  // has no bucket, and is applied client-side instead.
  const range = daterangeFor(opts.jobage)
  if (range) params.set("daterange", range)
  if (opts.sort) params.set("sortmode", opts.sort)
  params.set("page", String(opts.page))
  params.set("pagesize", String(Math.min(opts.limit, MAX_LIMIT)))
  return `${API_BASE}?${params.toString()}`
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 38).padEnd(38)
    const company = (c.company || "—").slice(0, 22).padEnd(22)
    const loc = (c.location || "—").slice(0, 20).padEnd(20)
    const sal = (c.salaryLabel || "—").slice(0, 24).padEnd(24)
    return `${title} ${company} ${loc} ${sal} ${c.date || "—"}  ${c.id}`
  })
  const header =
    "TITLE".padEnd(38) + " " + "COMPANY".padEnd(22) + " " + "LOCATION".padEnd(20) + " " + "SALARY".padEnd(24) + " POSTED      ID"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const want = opts.limit ?? 20
    const pageSize = Math.min(MAX_LIMIT, Math.max(want * 3, 20))
    const jobs: JobCard[] = []
    let total = 0
    let page = opts.page
    const maxPages = 10

    for (let i = 0; i < maxPages; i++) {
      const raw = await jsonFetch(
        buildUrl({ query: opts.query, location: opts.location, jobage: opts.jobage, sort: opts.sort, page, limit: pageSize }),
      )
      if (raw === null) break
      const parsed = parseSearchResponse(raw)
      total = parsed.total
      if (parsed.jobs.length === 0) break

      for (const job of parsed.jobs) {
        // Client-side backstop: daterange buckets are coarse (a 14-day request
        // is served by the 14 bucket, which is exact, but a 31+ request has no
        // bucket at all), and the portal also returns featured/boosted rows.
        if (opts.jobage < 9999) {
          const age = daysAgo(job.date)
          if (age !== null && age > opts.jobage) continue
        }
        if (jobs.some((j) => j.id === job.id)) continue
        jobs.push(job)
        if (jobs.length >= want) break
      }

      if (jobs.length >= want) break
      if (parsed.jobs.length < pageSize) break
      page++
    }

    if (opts.format === "table") {
      process.stdout.write(renderTable(jobs) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        jobs
          .map(
            (c) =>
              `${c.title}\n  ${c.company || "—"} · ${c.location || "—"}\n  ${c.salaryLabel || "salary undisclosed"} · posted ${c.date || "—"}\n  ${c.teaser || ""}\n  id: ${c.id}\n  ${c.url}`,
          )
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify({ meta: { count: jobs.length, page: opts.page, total }, results: jobs }, null, 2) + "\n",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
