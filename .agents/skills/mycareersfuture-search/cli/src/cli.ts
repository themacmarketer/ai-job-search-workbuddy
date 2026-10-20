#!/usr/bin/env bun
// Self-contained CLI for searching Singapore job listings on MyCareersFuture,
// the Workforce Singapore government portal. Backed by the public v2 REST API,
// so it runs anywhere `bun` is available with zero install beyond the repo clone.
//
// MyCareersFuture is a public government service. Its robots.txt allows all
// paths for generic user agents, and this CLI sends an honest UA that names
// itself. Keep request volume reasonable — it is a shared public service.

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
      // Support `--flag=value` as well as `--flag value`. Without this,
      // `--limit=5` became a flag literally named "limit=5".
      const eq = bare.indexOf("=")
      if (eq > 0) {
        flags[alias[bare.slice(0, eq)] ?? bare.slice(0, eq)] = bare.slice(eq + 1)
        continue
      }
      const key = alias[bare] ?? bare
      const next = argv[i + 1]
      // A negative number is a value, not the next flag: `--page -1` has to
      // reach validation as a bad value rather than as an unknown flag.
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

const HELP = `mycareersfuture-search — search Singapore jobs on MyCareersFuture (WSG)

USAGE
  bun run src/cli.ts search --query "<text>" [flags]
  bun run src/cli.ts detail <uuid|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keywords: job title, skill, or company. Recommended.
  --location, -l <text>   Filter by district, region, or postal code. Applied
                          client-side (the API has no location parameter):
                          e.g. "Jurong", "Central", "Tampines", "138577".
  --jobage <days>         Posted within N days. Applied client-side against the
                          posting date — the API has no age parameter.
  --min-salary <n>        Minimum monthly gross salary in SGD. Server-side; the
                          API matches postings whose range REACHES this value,
                          so a 5000 filter can still return a 3800-6500 posting.
  --sort <order>          newest (default) | relevance.
  --page <n>              0-indexed page (the API's own convention). Default 0.
  --limit, -n <n>         Cap results emitted. Default 20, max ${MAX_LIMIT}.
  --include-expired       Keep postings that are closed or past their deadline
                          (dropped by default).
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "software engineer" --jobage 7 --format table
  bun run src/cli.ts search -q "marketing manager" -l "Central" --min-salary 6000 --format table
  bun run src/cli.ts search -q "data analyst" --jobage 14 --limit 40 --format json
  bun run src/cli.ts detail d79c61fae9edc00c420cec7caf2c7087 --format plain

Data: public MyCareersFuture v2 API — no credentials required.
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set([
    "query", "location", "jobage", "min-salary", "sort", "page", "limit",
    "include-expired", "format", "help", "h",
  ]),
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

  // Unknown flags are rejected rather than discarded: the API ignores unknown
  // parameters and answers 200, so a silently dropped filter returns an
  // unfiltered result set that looks exactly like a successful search.
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

  const parsePositiveInt = (name: string, raw: string | boolean | string[]): number | null => {
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
      process.stderr.write(
        JSON.stringify({ error: "--query requires a non-empty value", code: "BAD_ARG" }) + "\n",
      )
      return 1
    }
    if (flags.location !== undefined && (typeof flags.location !== "string" || !flags.location.trim())) {
      process.stderr.write(
        JSON.stringify({ error: "--location requires a non-empty value", code: "BAD_ARG" }) + "\n",
      )
      return 1
    }

    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "table", "plain"].includes(fmt)) {
      process.stderr.write(
        JSON.stringify({ error: `--format must be one of json|table|plain, got "${fmt}"`, code: "BAD_ARG" }) + "\n",
      )
      return 1
    }

    const sort = flags.sort !== undefined ? String(flags.sort) : "newest"
    if (!["newest", "relevance"].includes(sort)) {
      process.stderr.write(
        JSON.stringify({ error: `--sort must be newest|relevance, got "${sort}"`, code: "BAD_ARG" }) + "\n",
      )
      return 1
    }

    if (flags.jobage !== undefined) {
      const v = parsePositiveInt("jobage", flags.jobage)
      if (v === null) return 1
      flags.jobage = String(v)
    }
    if (flags["min-salary"] !== undefined) {
      const v = parsePositiveInt("min-salary", flags["min-salary"])
      if (v === null) return 1
      flags["min-salary"] = String(v)
    }
    if (flags.page !== undefined) {
      // The API is 0-indexed, so page 0 is valid here even though every other
      // portal CLI in this repo is 1-indexed. Documented in SKILL.md.
      const val = typeof flags.page === "string" ? Number(flags.page.trim()) : NaN
      if (!Number.isInteger(val) || val < 0) {
        process.stderr.write(
          JSON.stringify({ error: `--page must be a whole number of at least 0, got "${flags.page}"`, code: "BAD_ARG" }) + "\n",
        )
        return 1
      }
      flags.page = String(val)
    }
    if (flags.limit !== undefined) {
      const v = parsePositiveInt("limit", flags.limit)
      if (v === null) return 1
      flags.limit = String(Math.min(v, MAX_LIMIT))
    }

    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query : undefined,
      location: typeof flags.location === "string" ? flags.location : undefined,
      jobage: flags.jobage ? Number(flags.jobage) : 9999,
      minSalary: flags["min-salary"] ? Number(flags["min-salary"]) : undefined,
      sort: sort as SearchOpts["sort"],
      page: flags.page ? Number(flags.page) : 0,
      limit: flags.limit ? Number(flags.limit) : 20,
      includeExpired: Boolean(flags["include-expired"]),
      format: fmt as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) {
      process.stderr.write(JSON.stringify({ error: "detail requires an <uuid|url>", code: "NO_ID" }) + "\n")
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
      JSON.stringify({
        error: e instanceof Error ? e.message : String(e),
        code: "INTERNAL_ERROR",
      }) + "\n",
    )
    process.exit(1)
  })
