import { describe, expect, test } from "bun:test";
import {
  daysAgo,
  formatLocation,
  formatSalary,
  htmlToText,
  parseSearchResponse,
  toCard,
  toDetail,
} from "../src/helpers";
import { fixture } from "./helpers";

// These run against a response captured from the live API on 2026-10-20, so a
// field rename upstream surfaces here as a failure rather than as a silent null
// in someone's job search.

describe("toCard against a captured response", () => {
  test("maps the contract fields the framework depends on", async () => {
    const body = await fixture("search");
    const job = body.results[0];
    const card = toCard(job);

    expect(card.id).toBe(job.uuid);
    expect(card.title).toBe(job.title);
    expect(card.company).toBe(job.postedCompany.name);
    expect(card.date).toBe(job.metadata.newPostingDate);
    expect(card.deadline).toBe(job.metadata.expiryDate);
    expect(card.url).toBe(job.metadata.jobDetailsUrl);
    // Contract requires these keys to be present, null at worst, never absent.
    for (const key of ["id", "title", "company", "location", "date", "url"]) {
      expect(key in card).toBe(true);
    }
  });

  test("surfaces the monthly SGD salary range", async () => {
    const body = await fixture("search");
    const card = toCard(body.results[0]);
    expect(card.salaryMin).toBe(4000);
    expect(card.salaryMax).toBe(6000);
    expect(card.salaryType).toBe("Monthly");
  });

  test("derives district, region and postal code from the address", async () => {
    const body = await fixture("search");
    const card = toCard(body.results[0]);
    expect(card.region).toBe("Central");
    expect(card.district).toMatch(/^D\d{2} /);
    expect(card.postalCode).toMatch(/^\d{6}$/);
  });

  test('treats the "Re-open" status as open', async () => {
    // A reposted role carries jobStatus "Re-open" (id 103). An exact match on
    // "Open" silently dropped these live postings as expired.
    const body = await fixture("search");
    const reopened = body.results.find((j: any) => j.status.jobStatus === "Re-open");
    expect(reopened).toBeDefined();
    expect(toCard(reopened).isOpen).toBe(true);
  });

  test("treats a closed status as closed", async () => {
    const body = await fixture("search");
    const job = { ...body.results[0], status: { id: 104, jobStatus: "Closed" } };
    expect(toCard(job).isOpen).toBe(false);
  });

  test("falls back to the short job URL when jobDetailsUrl is absent", async () => {
    const body = await fixture("search");
    const job = { ...body.results[0], metadata: { ...body.results[0].metadata, jobDetailsUrl: null } };
    expect(toCard(job).url).toBe(`https://www.mycareersfuture.gov.sg/job/${job.uuid}`);
  });
});

describe("toDetail", () => {
  test("decodes the description to readable text", async () => {
    const body = await fixture("detail");
    const detail = toDetail(body);
    expect(detail.description).toBeTruthy();
    expect(detail.description).not.toContain("<p>");
    expect(detail.description).not.toMatch(/&(amp|nbsp|lt|gt);/);
    expect(detail.description!.split("\n").length).toBeGreaterThan(1);
  });

  test("reports the screening question count", async () => {
    const body = await fixture("detail");
    const detail = toDetail(body);
    expect(detail.screeningQuestionCount).toBe(Array.isArray(body.screeningQuestions) ? body.screeningQuestions.length : 0);
  });

  test("collects the skill list", async () => {
    const body = await fixture("detail");
    const detail = toDetail(body);
    expect(Array.isArray(detail.skills)).toBe(true);
    expect(detail.skills.every((s) => typeof s === "string" && s.length > 0)).toBe(true);
  });
});

describe("parseSearchResponse", () => {
  test("parses a normal response", async () => {
    const body = await fixture("search");
    const { jobs, total } = parseSearchResponse(body);
    expect(jobs.length).toBe(body.results.length);
    expect(total).toBe(body.total);
  });

  test("tolerates a body with no results key", () => {
    // The live API returns this shape (no `results`) when limit exceeds 100.
    const { jobs, total } = parseSearchResponse({ error: "bad request" });
    expect(jobs).toEqual([]);
    expect(total).toBe(0);
  });

  test("tolerates null", () => {
    expect(parseSearchResponse(null).jobs).toEqual([]);
  });
});

describe("htmlToText", () => {
  test("strips tags and decodes entities", () => {
    const out = htmlToText("<p>Fish &amp; chips &lt;3 &#39;quoted&#39;</p>");
    expect(out).toBe("Fish & chips <3 'quoted'");
  });

  test("preserves paragraph breaks", () => {
    const out = htmlToText("<p>One</p><p>Two</p>");
    expect(out!.split("\n").filter(Boolean)).toEqual(["One", "Two"]);
  });

  test("returns null for empty input", () => {
    expect(htmlToText(null)).toBeNull();
    expect(htmlToText("")).toBeNull();
  });
});

describe("formatSalary", () => {
  test("formats a monthly range in SGD", () => {
    expect(formatSalary(5000, 8000, "Monthly")).toBe("S$5,000–8,000/mo");
  });

  test("collapses an equal range", () => {
    expect(formatSalary(5000, 5000, "Monthly")).toBe("S$5,000/mo");
  });

  test("handles a one-sided range", () => {
    expect(formatSalary(null, 8000, "Monthly")).toBe("S$8,000/mo");
  });

  test("shows an em dash when salary is undisclosed", () => {
    expect(formatSalary(null, null, null)).toBe("—");
  });
});

describe("daysAgo", () => {
  test("counts whole days back from today", () => {
    const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
    now.setUTCDate(now.getUTCDate() - 5);
    expect(daysAgo(now.toISOString().slice(0, 10))).toBe(5);
  });

  test("returns 0 for today", () => {
    const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
    expect(daysAgo(now.toISOString().slice(0, 10))).toBe(0);
  });

  test("returns null for missing or unparseable input", () => {
    expect(daysAgo(null)).toBeNull();
    expect(daysAgo("not-a-date")).toBeNull();
  });
});

describe("formatLocation", () => {
  test("prefers the building name", () => {
    expect(
      formatLocation({
        building: "MIDVIEW CITY",
        street: "SIN MING LANE",
        districts: [{ region: "Central" }],
      }),
    ).toBe("MIDVIEW CITY, Central");
  });

  test("falls back to the street when there is no building", () => {
    expect(formatLocation({ street: "SIN MING LANE", districts: [{ region: "West" }] })).toBe(
      "SIN MING LANE, West",
    );
  });

  test("falls back to Singapore when the address is empty", () => {
    expect(formatLocation({})).toBe("Singapore");
    expect(formatLocation(null)).toBeNull();
  });
});
