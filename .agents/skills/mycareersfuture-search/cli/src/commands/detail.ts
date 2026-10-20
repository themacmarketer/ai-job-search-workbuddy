import { API_BASE, formatSalary, jsonFetch, normalizeId, toDetail, writeError, type RawJob } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(
      `Could not parse a MyCareersFuture job ID from "${opts.id}" (expected a 32-character uuid or a mycareersfuture.gov.sg job URL)`,
      "BAD_ID",
    )
    return 1
  }

  try {
    const raw = await jsonFetch(`${API_BASE}/jobs/${id}`)
    if (raw === null) {
      writeError("Job not found", "NOT_FOUND")
      return 1
    }
    const job = toDetail(raw as RawJob)

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        "",
        `Salary: ${formatSalary(job.salaryMin, job.salaryMax, job.salaryType)}`,
        `Posted: ${job.date || "—"}   Closes: ${job.deadline || "—"}`,
        job.employmentTypes.length ? `Employment: ${job.employmentTypes.join(", ")}` : "",
        job.positionLevels.length ? `Level: ${job.positionLevels.join(", ")}` : "",
        job.minYearsExperience !== null ? `Min experience: ${job.minYearsExperience} years` : "",
        job.numberOfVacancies !== null ? `Vacancies: ${job.numberOfVacancies}` : "",
        job.postalCode ? `Postal code: ${job.postalCode}` : "",
        `Status: ${job.isOpen ? "OPEN" : "CLOSED"}`,
        job.skills.length ? `Skills: ${job.skills.join(", ")}` : "",
        job.screeningQuestionCount ? `Screening questions: ${job.screeningQuestionCount}` : "",
        "",
        job.description || "(no description)",
        job.otherRequirements ? `\nOther requirements:\n${job.otherRequirements}` : "",
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
