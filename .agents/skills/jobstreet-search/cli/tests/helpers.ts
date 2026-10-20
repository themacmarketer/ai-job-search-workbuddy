import { join } from "path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const CLI_PATH = join(import.meta.dir, "../src/cli.ts");
const API_ORIGIN = "https://sg.jobstreet.com";

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
  return JSON.parse(result.stdout) as T;
}

/** Run the CLI against a canned response and report the URLs it requested. */
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

  const dir = mkdtempSync(join(tmpdir(), "jobstreet-fixture-"));
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

export async function fixture(): Promise<any> {
  return Bun.file(join(import.meta.dir, "fixtures/search.json")).json();
}

export function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

let counter = 0;

export function makeJob(overrides: { postedDaysAgo?: number; salaryLabel?: string; location?: string } = {}): any {
  counter += 1;
  return {
    id: String(90000000 + counter),
    title: `Synthetic Engineer ${counter}`,
    advertiser: { id: "1", description: "Test Company Pte Ltd" },
    locations: [{ label: overrides.location ?? "Singapore", countryCode: "SG" }],
    listingDate: isoDaysAgo(overrides.postedDaysAgo ?? 1),
    salaryLabel: overrides.salaryLabel ?? "$5,000 – $6,000 per month",
    workTypes: ["Full time"],
    workArrangements: { data: [{ id: "1", label: { text: "On-site" } }] },
    classifications: [
      {
        classification: { id: "6281", description: "Information & Communication Technology" },
        subclassification: { id: "6290", description: "Engineering - Software" },
      },
    ],
    bulletPoints: [],
    teaser: "Do the thing.",
    tags: [],
  };
}

export function searchBody(jobs: any[]): unknown {
  return { data: jobs, totalCount: jobs.length };
}
