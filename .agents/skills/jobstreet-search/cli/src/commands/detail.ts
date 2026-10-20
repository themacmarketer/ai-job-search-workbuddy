import {
  API_BASE,
  jsonFetch,
  normalizeId,
  parseSearchResponse,
  toDetail,
  writeError,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/**
 * Resolve one posting through the search endpoint's `jobid` parameter.
 *
 * JobStreet has no reachable per-job JSON endpoint (the `/job/<id>` page is
 * Cloudflare-gated and the guessed API paths 404), but `search?jobid=<id>`
 * returns exactly that posting with totalCount 1. It carries the listing
 * metadata, salary label and teaser — not the full description, which this CLI
 * reports as unavailable rather than inventing.
 */
export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(
      `Could not parse a JobStreet job ID from "${opts.id}" (expected a numeric id or a jobstreet job URL)`,
      "BAD_ID",
    )
    return 1
  }

  try {
    const params = new URLSearchParams()
    params.set("siteKey", "SG-Main")
    params.set("sourcesystem", "houston")
    params.set("jobid", id)
    params.set("pagesize", "1")
    const raw = await jsonFetch(`${API_BASE}?${params.toString()}`)
    if (raw === null) {
      writeError("Job not found", "NOT_FOUND")
      return 1
    }
    const { jobs } = parseSearchResponse(raw)
    const found = jobs.find((j) => j.id === id) ?? jobs[0]
    if (!found) {
      writeError(`Job ${id} not found`, "NOT_FOUND")
      return 1
    }

    // Re-run the raw record through toDetail so bulletPoints/tags survive.
    const rawJob = ((raw as { data?: unknown[] }).data ?? []).find(
      (j) => (j as { id?: string }).id === id,
    ) as Parameters<typeof toDetail>[0] | undefined
    const job = toDetail(rawJob ?? ({} as Parameters<typeof toDetail>[0]))

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        "",
        `Salary: ${job.salaryLabel || "undisclosed"}`,
        `Posted: ${job.date || "—"}`,
        job.workTypes.length ? `Work type: ${job.workTypes.join(", ")}` : "",
        job.workArrangement ? `Arrangement: ${job.workArrangement}` : "",
        job.classification ? `Category: ${job.classification}${job.subclassification ? ` / ${job.subclassification}` : ""}` : "",
        job.tags.length ? `Tags: ${job.tags.join(", ")}` : "",
        "",
        job.teaser ? `Teaser: ${job.teaser}` : "",
        job.bulletPoints.length ? `\nHighlights:\n- ${job.bulletPoints.join("\n- ")}` : "",
        "",
        `Description: NOT AVAILABLE — ${job.descriptionNote}`,
        "",
        `URL: ${job.url}`,
      ].filter((l) => l !== "")
      process.stdout.write(lines.join("\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
