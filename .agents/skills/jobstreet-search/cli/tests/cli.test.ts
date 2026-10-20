import { describe, expect, test } from "bun:test";
import { daterangeFor, normalizeId, parseSalaryLabel, toCard, toDetail } from "../src/helpers";
import { fixture, makeJob, parseJSON, runCLI, runWithFixture, searchBody } from "./helpers";

function expectCliError(result: { exitCode: number; stdout: string; stderr: string }, code: string) {
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(JSON.parse(result.stderr).code).toBe(code);
}

describe("flag validation", () => {
  test("unknown flag is rejected, not dropped", async () => {
    expectCliError(await runCLI(["search", "-q", "x", "--bogus"]), "UNKNOWN_FLAG");
  });
  test("bad format is rejected", async () => {
    expectCliError(await runCLI(["search", "-q", "x", "--format", "csv"]), "BAD_ARG");
  });
  test("bad sort mode is rejected", async () => {
    expectCliError(await runCLI(["search", "-q", "x", "--sort", "salary"]), "BAD_ARG");
  });
  test("jobage 0 is rejected", async () => {
    expectCliError(await runCLI(["search", "-q", "x", "--jobage", "0"]), "BAD_ARG");
  });
  test("page 0 is rejected on this 1-indexed portal", async () => {
    expectCliError(await runCLI(["search", "-q", "x", "--page", "0"]), "BAD_ARG");
  });
  test("detail without an id is rejected", async () => {
    expectCliError(await runCLI(["detail"]), "NO_ID");
  });
  test("unknown command is rejected", async () => {
    expectCliError(await runCLI(["frobnicate"]), "BAD_CMD");
  });
});

describe("parseSalaryLabel", () => {
  test("parses a range", () => {
    expect(parseSalaryLabel("$5,000 – $6,000 per month")).toEqual({ min: 5000, max: 6000 });
  });
  test("parses a single value as both bounds", () => {
    expect(parseSalaryLabel("$4,500 per month")).toEqual({ min: 4500, max: 4500 });
  });
  test('treats "From X" as a floor', () => {
    expect(parseSalaryLabel("From $4,000 per month")).toEqual({ min: 4000, max: null });
  });
  test('treats "Up to X" as a ceiling', () => {
    expect(parseSalaryLabel("Up to $8,000 per month")).toEqual({ min: null, max: 8000 });
  });
  test("returns nulls for negotiable or missing labels", () => {
    expect(parseSalaryLabel("Negotiable")).toEqual({ min: null, max: null });
    expect(parseSalaryLabel(null)).toEqual({ min: null, max: null });
  });
});

describe("normalizeId", () => {
  test("accepts a numeric id", () => {
    expect(normalizeId("95372516")).toBe("95372516");
  });
  test("accepts a sg.jobstreet.com job URL", () => {
    expect(normalizeId("https://sg.jobstreet.com/job/95372516")).toBe("95372516");
  });
  test("accepts a jobstreet.com.sg job URL", () => {
    expect(normalizeId("https://www.jobstreet.com.sg/job/95372516")).toBe("95372516");
  });
  test("rejects a foreign host", () => {
    expect(normalizeId("https://example.com/job/95372516")).toBeNull();
  });
  test("rejects a look-alike host", () => {
    expect(normalizeId("https://jobstreet.com.evil.io/job/95372516")).toBeNull();
  });
  test("rejects a too-short number", () => {
    expect(normalizeId("123")).toBeNull();
  });
});

describe("daterangeFor", () => {
  test("maps windows onto the portal's discrete buckets", () => {
    expect(daterangeFor(1)).toBe("1");
    expect(daterangeFor(7)).toBe("7");
    expect(daterangeFor(10)).toBe("14");
    expect(daterangeFor(14)).toBe("14");
    expect(daterangeFor(31)).toBe("31");
  });
  test("returns null for windows with no bucket", () => {
    expect(daterangeFor(60)).toBeNull();
    expect(daterangeFor(9999)).toBeNull();
  });
});

describe("toCard against a captured response", () => {
  test("maps the contract fields", async () => {
    const body = await fixture();
    const raw = body.data[0];
    const card = toCard(raw);
    expect(card.id).toBe(raw.id);
    expect(card.title).toBe(raw.title);
    expect(card.company).toBe(raw.advertiser.description);
    expect(card.date).toBe(raw.listingDate.slice(0, 10));
    expect(card.url).toBe(`https://sg.jobstreet.com/job/${raw.id}`);
    for (const key of ["id", "title", "company", "location", "date", "url"]) {
      expect(key in card).toBe(true);
    }
  });

  test("parses the salary label from a real posting", async () => {
    const body = await fixture();
    const paid = body.data.find((j: any) => j.salaryLabel);
    const card = toCard(paid);
    expect(card.salaryMin).toBeGreaterThan(0);
    expect(card.salaryMax).toBeGreaterThanOrEqual(card.salaryMin!);
  });

  test("leaves salary null when undisclosed", async () => {
    const body = await fixture();
    const unpaid = body.data.find((j: any) => !j.salaryLabel);
    if (unpaid) {
      expect(toCard(unpaid).salaryMin).toBeNull();
    }
  });
});

describe("toDetail", () => {
  test("reports the description as unavailable rather than inventing one", () => {
    const detail = toDetail(makeJob());
    expect(detail.description).toBeNull();
    expect(detail.descriptionAvailable).toBe(false);
    expect(detail.descriptionNote).toContain("Cloudflare");
  });
});

describe("search request", () => {
  test("sends the portal's required params and the daterange bucket", async () => {
    const { requests } = await runWithFixture(["search", "-q", "engineer", "--jobage", "7", "--format", "json"], () =>
      searchBody([makeJob()]),
    );
    const u = requests[0];
    expect(u.searchParams.get("siteKey")).toBe("SG-Main");
    expect(u.searchParams.get("keywords")).toBe("engineer");
    expect(u.searchParams.get("daterange")).toBe("7");
    expect(u.searchParams.get("page")).toBe("1");
  });

  test("omits daterange when the window has no bucket", async () => {
    const { requests } = await runWithFixture(["search", "-q", "engineer", "--jobage", "60", "--format", "json"], () =>
      searchBody([makeJob({ postedDaysAgo: 1 })]),
    );
    expect(requests[0].searchParams.has("daterange")).toBe(false);
  });

  test("passes --location through as where", async () => {
    const { requests } = await runWithFixture(["search", "-q", "engineer", "-l", "Jurong East", "--format", "json"], () =>
      searchBody([makeJob()]),
    );
    expect(requests[0].searchParams.get("where")).toBe("Jurong East");
  });

  test("clamps --limit to the pagesize ceiling", async () => {
    const { requests } = await runWithFixture(["search", "-q", "engineer", "--limit", "500", "--format", "json"], () =>
      searchBody([makeJob()]),
    );
    expect(Number(requests[0].searchParams.get("pagesize"))).toBeLessThanOrEqual(100);
  });
});

describe("client-side backstop", () => {
  test("drops postings older than the requested window", async () => {
    const { result } = await runWithFixture(["search", "-q", "engineer", "--jobage", "7", "--format", "json"], () =>
      searchBody([
        makeJob({ postedDaysAgo: 1 }),
        makeJob({ postedDaysAgo: 30 }),
      ]),
    );
    const { results } = parseJSON<{ results: any[] }>(result);
    expect(results.length).toBe(1);
  });
});

describe("detail", () => {
  test("looks the job up through the jobid parameter", async () => {
    const job = makeJob();
    const { result, requests } = await runWithFixture(["detail", job.id, "--format", "json"], () =>
      searchBody([job]),
    );
    expect(result.exitCode).toBe(0);
    expect(requests[0].searchParams.get("jobid")).toBe(job.id);
    expect(parseJSON<any>(result).id).toBe(job.id);
  });

  test("reports NOT_FOUND when the lookup returns nothing", async () => {
    const { result } = await runWithFixture(["detail", "99999999", "--format", "json"], () => searchBody([]));
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr).code).toBe("NOT_FOUND");
  });

  test("rejects a foreign host without making a request", async () => {
    const { result, requests } = await runWithFixture(["detail", "https://example.com/job/95372516"], () => ({}));
    expect(result.exitCode).toBe(1);
    expect(requests.length).toBe(0);
  });
});

describe("output formats", () => {
  test("table carries the full id", async () => {
    const job = makeJob();
    const { result } = await runWithFixture(["search", "-q", "engineer", "--format", "table"], () => searchBody([job]));
    expect(result.stdout).toContain(job.id);
  });

  test("plain output warns that the description is unavailable", async () => {
    const job = makeJob();
    const { result } = await runWithFixture(["detail", job.id, "--format", "plain"], () => searchBody([job]));
    expect(result.stdout).toContain("NOT AVAILABLE");
  });
});
