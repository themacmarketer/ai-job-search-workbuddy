#!/usr/bin/env bun
// CLI for searching Singapore job listings on JobStreet (SEEK).
//
// ⚠️ PERSONAL USE ONLY. JobStreet's robots.txt disallows `/api/jobsearch/` for
// generic user agents and disallows several AI crawlers outright. This skill
// ships with `enabled: false` for that reason — it is opt-in, low-volume, and
// the user's own decision. See SKILL.md before enabling it.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { MAX_LIMIT } from "./helpers.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("--") || a.startsWith("-")) {
      const bare = a.replace(/^-+/, "")
      const eq = bare.indexOf("=")
      if (eq > 0) {
        flags[alias[bare.slice(0, eq)] ?? bare.slice(0, eq)] = bare.slice(eq + 1)
        continue
      }
      const key = alias[bare] ?? bare
      const next = argv[i + 1]
      const isNegativeNumber = next !== undefined && /^-\d+(\.\d+)?$/.test(next)
      if (next === undefined || (next.startsWith("-") && !isNegativeNumber)) {
        flags[key] = true
      } else {
        flags[key] = next
        i++
      }
    } else {
      ;(flags._ as string[]).push(a)
    }
  }
  return flags
}

const HELP = `jobstreet-search — search Singapore jobs on JobStreet (SEEK)

⚠️  PERSONAL USE ONLY. JobStreet's robots.txt disallows /api/jobsearch/.
    Keep volume low. This skill ships disabled; enable it deliberately.

USAGE
  bun run src/cli.ts search --query "<text>" [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keywords: job title, skill, or company. Recommended.
  --location, -l <text>   Where to search, server-side: e.g. "Jurong East",
                          "Central Region", "Singapore".
  --jobage <days>         Posted within N days. Server-side via daterange
                          buckets 1/7/14/31; wider windows filter client-side.
  --sort <mode>           sortmode: ListedDate | KeywordRelevance.
  --page <n>              1-indexed. Default 1.
  --limit, -n <n>         Cap results emitted. Default 20, max ${MAX_LIMIT}.
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "software engineer" --jobage 7 --format table
  bun run src/cli.ts search -q "marketing" -l "Central Region" --jobage 14 --format table
  bun run src/cli.ts detail 95372516 --format plain

NOTE: the full job description is NOT available — JobStreet serves posting
pages behind a Cloudflare challenge. search/detail return listing metadata,
salary label and a teaser only. Paste the posting text into /apply for a full
evaluation.
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "location", "jobage", "sort", "page", "limit", "format", "help", "h"]),
  detail: new Set(["format", "help", "h"]),
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const flags = parseFlags(argv)
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  const knownFlags = KNOWN_FLAGS[cmd]
  if (knownFlags) {
    for (const key of Object.keys(flags)) {
      if (key === "_" || knownFlags.has(key)) continue
      process.stderr.write(
        JSON.stringify({
          error: `unknown flag --${key} for '${cmd}' - flags are never silently ignored, because a discarded filter changes what the search returns; see --help for the supported flags`,
          code: "UNKNOWN_FLAG",
        }) + "\n",
      )
      return 1
    }
  }

  const positiveInt = (name: string, raw: string | boolean | string[]): number | null => {
    const val = typeof raw === "string" ? Number(raw.trim()) : NaN
    if (!Number.isInteger(val) || val < 1) {
      process.stderr.write(
        JSON.stringify({ error: `--${name} must be a whole number of at least 1, got "${raw}"`, code: "BAD_ARG" }) + "\n",
      )
      return null
    }
    return val
  }

  if (cmd === "search") {
    if (flags.query !== undefined && (typeof flags.query !== "string" || !flags.query.trim())) {
      process.stderr.write(JSON.stringify({ error: "--query requires a non-empty value", code: "BAD_ARG" }) + "\n")
      return 1
    }
    if (flags.location !== undefined && (typeof flags.location !== "string" || !flags.location.trim())) {
      process.stderr.write(JSON.stringify({ error: "--location requires a non-empty value", code: "BAD_ARG" }) + "\n")
      return 1
    }
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "table", "plain"].includes(fmt)) {
      process.stderr.write(
        JSON.stringify({ error: `--format must be one of json|table|plain, got "${fmt}"`, code: "BAD_ARG" }) + "\n",
      )
      return 1
    }
    if (flags.sort !== undefined) {
      const sort = String(flags.sort)
      if (!["ListedDate", "KeywordRelevance"].includes(sort)) {
        process.stderr.write(
          JSON.stringify({ error: `--sort must be ListedDate|KeywordRelevance, got "${sort}"`, code: "BAD_ARG" }) + "\n",
        )
        return 1
      }
    }
    if (flags.jobage !== undefined) {
      const v = positiveInt("jobage", flags.jobage)
      if (v === null) return 1
      flags.jobage = String(v)
    }
    if (flags.page !== undefined) {
      const v = positiveInt("page", flags.page)
      if (v === null) return 1
      flags.page = String(v)
    }
    if (flags.limit !== undefined) {
      const v = positiveInt("limit", flags.limit)
      if (v === null) return 1
      flags.limit = String(Math.min(v, MAX_LIMIT))
    }

    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query : undefined,
      location: typeof flags.location === "string" ? flags.location : undefined,
      jobage: flags.jobage ? Number(flags.jobage) : 9999,
      sort: typeof flags.sort === "string" ? flags.sort : undefined,
      page: flags.page ? Number(flags.page) : 1,
      limit: flags.limit ? Number(flags.limit) : 20,
      format: fmt as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) {
      process.stderr.write(JSON.stringify({ error: "detail requires an <id|url>", code: "NO_ID" }) + "\n")
      return 1
    }
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "plain"].includes(fmt)) {
      process.stderr.write(
        JSON.stringify({ error: `--format must be one of json|plain, got "${fmt}"`, code: "BAD_ARG" }) + "\n",
      )
      return 1
    }
    const opts: DetailOpts = { id, format: fmt as DetailOpts["format"] }
    return runDetail(opts)
  }

  process.stderr.write(JSON.stringify({ error: `Unknown command "${cmd}"`, code: "BAD_CMD" }) + "\n")
  return 1
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e), code: "INTERNAL_ERROR" }) + "\n",
    )
    process.exit(1)
  })
