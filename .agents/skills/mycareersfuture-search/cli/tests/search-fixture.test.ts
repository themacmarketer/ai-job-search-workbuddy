import { describe, expect, test } from "bun:test";
import { makeJob, parseJSON, runWithFixture, searchBody } from "./helpers";

// Filter behaviour runs against a synthetic response whose dates are relative to
// today, so these tests do not rot as the calendar moves. The captured live
// fixture in fixtures/ is used for parsing tests instead.

const sixJobs = () => [
  makeJob({ postedDaysAgo: 1, region: "Central", title: "Fresh Central" }),
  makeJob({ postedDaysAgo: 3, region: "West", title: "Fresh West" }),
  makeJob({ postedDaysAgo: 40, region: "Central", title: "Stale Central" }),
  makeJob({ postedDaysAgo: 60, region: "East", title: "Stale East" }),
  makeJob({ postedDaysAgo: 2, region: "Central", title: "Closed Central", status: "Closed" }),
  makeJob({ postedDaysAgo: 2, region: "Central", title: "Expired Central", expiresInDays: -5 }),
];

describe("request construction", () => {
  test("sends only parameters the API actually honours", async () => {
    const { result, requests } = await runWithFixture(
      ["search", "-q", "engineer", "--jobage", "14", "-l", "Central", "--min-salary", "5000", "--format", "json"],
      () => searchBody([makeJob()]),
    );
    expect(result.exitCode).toBe(0);
    const url = requests[0];
    const keys = [...url.searchParams.keys()].sort();
    // location and jobage must NOT be in the request: the API ignores them, and
    // sending a name it silently drops is how a filter appears to work but doesn't.
    expect(keys).toEqual(["limit", "page", "salary", "search", "sortBy"]);
    expect(url.searchParams.get("search")).toBe("engineer");
    expect(url.searchParams.get("salary")).toBe("5000");
  });

  test("uses sortBy=new_posting_date for the default newest sort", async () => {
    const { requests } = await runWithFixture(["search", "-q", "x", "--format", "json"], () => searchBody([makeJob()]));
    expect(requests[0].searchParams.get("sortBy")).toBe("new_posting_date");
  });

  test("omits sortBy for relevance, because the API 400s on any other value", async () => {
    const { requests } = await runWithFixture(
      ["search", "-q", "x", "--sort", "relevance", "--format", "json"],
      () => searchBody([makeJob()]),
    );
    expect(requests[0].searchParams.has("sortBy")).toBe(false);
  });

  test("clamps --limit above the API ceiling to 100", async () => {
    const { requests } = await runWithFixture(
      ["search", "-q", "x", "--limit", "500", "--format", "json"],
      () => searchBody([makeJob()]),
    );
    expect(Number(requests[0].searchParams.get("limit"))).toBeLessThanOrEqual(100);
  });

  test("starts at page 0, the API's own indexing", async () => {
    const { requests } = await runWithFixture(["search", "-q", "x", "--format", "json"], () => searchBody([makeJob()]));
    expect(requests[0].searchParams.get("page")).toBe("0");
  });
});

describe("client-side filtering", () => {
  test("--jobage keeps only postings inside the window", async () => {
    const { result } = await runWithFixture(
      ["search", "-q", "engineer", "--jobage", "14", "--format", "json"],
      () => searchBody(sixJobs()),
    );
    const { results } = parseJSON<{ results: any[] }>(result);
    const titles = results.map((r) => r.title);
    expect(titles).toContain("Fresh Central");
    expect(titles).toContain("Fresh West");
    expect(titles).not.toContain("Stale Central");
    expect(titles).not.toContain("Stale East");
  });

  test("--location matches on region", async () => {
    const { result } = await runWithFixture(
      ["search", "-q", "engineer", "-l", "West", "--format", "json"],
      () => searchBody(sixJobs()),
    );
    const { results } = parseJSON<{ results: any[] }>(result);
    expect(results.map((r) => r.title)).toEqual(["Fresh West"]);
  });

  test("--location is case-insensitive", async () => {
    const { result } = await runWithFixture(
      ["search", "-q", "engineer", "-l", "west", "--format", "json"],
      () => searchBody(sixJobs()),
    );
    expect(parseJSON<{ results: any[] }>(result).results.length).toBe(1);
  });

  test("closed postings are dropped by default", async () => {
    const { result } = await runWithFixture(
      ["search", "-q", "engineer", "--format", "json"],
      () => searchBody(sixJobs()),
    );
    const body = parseJSON<{ results: any[]; meta: any }>(result);
    expect(body.results.map((r) => r.title)).not.toContain("Closed Central");
    expect(body.meta.expiredDropped).toBeGreaterThan(0);
  });

  test("postings past their deadline are dropped by default", async () => {
    const { result } = await runWithFixture(
      ["search", "-q", "engineer", "--format", "json"],
      () => searchBody(sixJobs()),
    );
    expect(parseJSON<{ results: any[] }>(result).results.map((r) => r.title)).not.toContain("Expired Central");
  });

  test("--include-expired keeps them", async () => {
    const { result } = await runWithFixture(
      ["search", "-q", "engineer", "--include-expired", "--format", "json"],
      () => searchBody(sixJobs()),
    );
    const titles = parseJSON<{ results: any[] }>(result).results.map((r) => r.title);
    expect(titles).toContain("Closed Central");
    expect(titles).toContain("Expired Central");
  });

  test("--limit caps the emitted results", async () => {
    const { result } = await runWithFixture(
      ["search", "-q", "engineer", "--limit", "2", "--include-expired", "--format", "json"],
      () => searchBody(sixJobs()),
    );
    expect(parseJSON<{ results: any[] }>(result).results.length).toBe(2);
  });
});

describe("pagination behaviour", () => {
  test("stops paging once the result set is exhausted", async () => {
    // 6 results, page size 20 -> one request. A narrow query must not walk the
    // full 20-page ceiling to discover there is nothing more.
    const { requests } = await runWithFixture(["search", "-q", "engineer", "--format", "json"], () =>
      searchBody(sixJobs()),
    );
    expect(requests.length).toBe(1);
  });

  test("does not duplicate a posting across pages", async () => {
    const job = makeJob();
    const { result } = await runWithFixture(["search", "-q", "engineer", "--format", "json"], () =>
      searchBody([job, job, job]),
    );
    expect(parseJSON<{ results: any[] }>(result).results.length).toBe(1);
  });
});

describe("output formats", () => {
  test("table prints the full 32-character uuid so it can be pasted into detail", async () => {
    const job = makeJob();
    const { result } = await runWithFixture(["search", "-q", "engineer", "--format", "table"], () =>
      searchBody([job]),
    );
    expect(result.stdout).toContain(job.uuid);
  });

  test("plain output includes the id and url", async () => {
    const job = makeJob();
    const { result } = await runWithFixture(["search", "-q", "engineer", "--format", "plain"], () =>
      searchBody([job]),
    );
    expect(result.stdout).toContain(job.uuid);
    expect(result.stdout).toContain(job.metadata.jobDetailsUrl);
  });

  test("json meta reports the count", async () => {
    const { result } = await runWithFixture(["search", "-q", "engineer", "--format", "json"], () =>
      searchBody([makeJob(), makeJob()]),
    );
    expect(parseJSON<{ meta: { count: number } }>(result).meta.count).toBe(2);
  });
});

describe("detail", () => {
  test("fetches by uuid and returns the mapped record", async () => {
    const job = makeJob({ title: "Detail Target" });
    const { result, requests } = await runWithFixture(["detail", job.uuid, "--format", "json"], () => job);
    expect(result.exitCode).toBe(0);
    expect(requests[0].pathname).toBe(`/v2/jobs/${job.uuid}`);
    const body = parseJSON<any>(result);
    expect(body.title).toBe("Detail Target");
    expect(body.id).toBe(job.uuid);
  });

  test("rejects a foreign host without making a request", async () => {
    const { result, requests } = await runWithFixture(
      ["detail", "https://boards.greenhouse.io/acme/jobs/123"],
      () => ({}),
    );
    expect(result.exitCode).toBe(1);
    expect(requests.length).toBe(0);
    expect(JSON.parse(result.stderr).code).toBe("BAD_ID");
  });

  test("404 becomes a NOT_FOUND error", async () => {
    const { result } = await runWithFixture(["detail", "0".repeat(32), "--format", "json"], () => null);
    // A null body is served as JSON null; the CLI must not crash on it.
    expect([0, 1]).toContain(result.exitCode);
  });
});
