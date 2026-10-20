import { join } from "path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const CLI_PATH = join(import.meta.dir, "../src/cli.ts");
const API_ORIGIN = "https://api.mycareersfuture.gov.sg";

export interface CLIResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function runCLI(args: string[], preload?: string): Promise<CLIResult> {
  const proc = Bun.spawn(["bun", "run", ...(preload ? ["--preload", preload] : []), CLI_PATH, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

export function parseJSON<T = unknown>(result: CLIResult): T {
  if (result.exitCode !== 0) {
    throw new Error(`CLI exited with code ${result.exitCode}. stderr: ${result.stderr}`);
  }
  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    throw new Error(`Failed to parse JSON. stdout: ${result.stdout}\nstderr: ${result.stderr}`);
  }
}

/**
 * Run the CLI against a canned API response instead of the live service, and
 * report the URLs it actually requested.
 *
 * `respond` receives the incoming path+query and returns the JSON body to serve.
 * Redirecting through a preload (rather than stubbing inside the CLI) means the
 * real fetch path, JSON parsing and retry logic all still execute.
 */
export async function runWithFixture(
  args: string[],
  respond: (url: URL) => unknown,
): Promise<{ result: CLIResult; requests: URL[] }> {
  const requests: URL[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      requests.push(url);
      return Response.json(respond(url));
    },
  });

  const dir = mkdtempSync(join(tmpdir(), "mcf-fixture-"));
  const preload = join(dir, "fetch.ts");
  writeFileSync(
    preload,
    `
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const raw = input instanceof Request ? input.url : String(input);
      const url = new URL(raw);
      if (url.origin !== ${JSON.stringify(API_ORIGIN)}) {
        throw new Error("Unexpected outbound request to " + url.origin);
      }
      return originalFetch(${JSON.stringify(server.url.origin)} + url.pathname + url.search, init);
    };
  `,
  );

  try {
    return { result: await runCLI(args, preload), requests };
  } finally {
    server.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Load a captured live response. */
export async function fixture(name: "search" | "detail"): Promise<any> {
  return Bun.file(join(import.meta.dir, `fixtures/${name}.json`)).json();
}

/** ISO date N days before today (Singapore date), for synthetic fixtures. */
export function isoDaysAgo(days: number): string {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  now.setUTCDate(now.getUTCDate() - days);
  return now.toISOString().slice(0, 10);
}

let counter = 0;

/**
 * Minimal synthetic job in the API's own shape. Dates are relative to today so
 * filter tests never go stale as the calendar moves.
 */
export function makeJob(overrides: {
  postedDaysAgo?: number;
  expiresInDays?: number;
  region?: string;
  status?: string;
  salaryMin?: number;
  salaryMax?: number;
  title?: string;
} = {}): any {
  const posted = isoDaysAgo(overrides.postedDaysAgo ?? 1);
  const expires = isoDaysAgo(-(overrides.expiresInDays ?? 30));
  counter += 1;
  const uuid = counter.toString(16).padStart(32, "0");
  return {
    uuid,
    title: overrides.title ?? `Synthetic Engineer ${counter}`,
    description: "<p>Build things.</p>",
    otherRequirements: null,
    workingHours: null,
    minimumYearsExperience: 2,
    numberOfVacancies: 1,
    ssocCode: 21522,
    salary: {
      minimum: overrides.salaryMin ?? 5000,
      maximum: overrides.salaryMax ?? 7000,
      type: { id: 4, salaryType: "Monthly" },
    },
    address: {
      block: "1",
      street: "TEST STREET",
      building: "TEST BUILDING",
      postalCode: "018956",
      districts: [{ id: 1, location: "D01 Raffles Place, Cecil, Marina", region: overrides.region ?? "Central" }],
    },
    metadata: {
      jobPostId: `MCF-TEST-${counter}`,
      newPostingDate: posted,
      originalPostingDate: posted,
      expiryDate: expires,
      jobDetailsUrl: `https://www.mycareersfuture.gov.sg/job/test/synthetic-${uuid}`,
    },
    skills: [{ skill: "Testing" }],
    categories: [{ id: 21, category: "Information Technology" }],
    employmentTypes: [{ id: 7, employmentType: "Permanent" }],
    positionLevels: [{ id: 8, position: "Senior Executive" }],
    status: { id: 102, jobStatus: overrides.status ?? "Open" },
    postedCompany: { uen: "202000001A", name: "Test Company Pte Ltd", description: "<p>We test.</p>" },
    hiringCompany: null,
  };
}

export function searchBody(jobs: any[]): unknown {
  return { results: jobs, total: jobs.length, countWithoutFilters: jobs.length };
}
