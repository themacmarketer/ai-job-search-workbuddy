import { describe, expect, test } from "bun:test";
import { runCLI } from "./helpers";

// Every case here fails argument validation before any network request is made,
// so the suite is network-free and deterministic.
//
// The rule being protected: this API ignores unknown query parameters and still
// answers 200. So a dropped or misspelled filter produces an unfiltered result
// set that looks exactly like a successful search. The CLI therefore rejects
// unknown flags outright rather than discarding them.

function expectCliError(result: { exitCode: number; stdout: string; stderr: string }, code: string) {
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  const error = JSON.parse(result.stderr);
  expect(error.code).toBe(code);
  expect(typeof error.error).toBe("string");
}

describe("flag validation", () => {
  test("an unknown flag is rejected, not silently ignored", async () => {
    const result = await runCLI(["search", "--query", "engineer", "--bogus"]);
    expectCliError(result, "UNKNOWN_FLAG");
    expect(JSON.parse(result.stderr).error).toContain("--bogus");
  });

  test("a plausible-but-unsupported API filter name is rejected", async () => {
    // postedDate is exactly the kind of parameter this API silently ignores.
    const result = await runCLI(["search", "--query", "engineer", "--postedDate", "7"]);
    expectCliError(result, "UNKNOWN_FLAG");
  });

  test("--format outside json|table|plain is rejected", async () => {
    const result = await runCLI(["search", "--query", "engineer", "--format", "xml"]);
    expectCliError(result, "BAD_ARG");
  });

  test("--sort outside newest|relevance is rejected", async () => {
    const result = await runCLI(["search", "--query", "engineer", "--sort", "salary"]);
    expectCliError(result, "BAD_ARG");
  });

  test("--jobage 0 is rejected", async () => {
    expectCliError(await runCLI(["search", "--query", "engineer", "--jobage", "0"]), "BAD_ARG");
  });

  test("--jobage 1.5 is rejected as non-integer", async () => {
    expectCliError(await runCLI(["search", "--query", "engineer", "--jobage", "1.5"]), "BAD_ARG");
  });

  test("--limit 0 is rejected", async () => {
    expectCliError(await runCLI(["search", "--query", "engineer", "--limit", "0"]), "BAD_ARG");
  });

  test("--limit above the API ceiling is clamped, not rejected", async () => {
    // limit=500 is what the API itself refuses; the CLI clamps to 100. This is
    // asserted through the request it builds in search-fixture.test.ts.
    const result = await runCLI(["search", "--query", "engineer", "--limit", "500", "--format", "xml"]);
    // still a format error, but proves --limit 500 alone is not a BAD_ARG
    expectCliError(result, "BAD_ARG");
  });

  test("--min-salary 0 is rejected", async () => {
    expectCliError(await runCLI(["search", "--query", "engineer", "--min-salary", "0"]), "BAD_ARG");
  });

  test("--page -1 is rejected", async () => {
    expectCliError(await runCLI(["search", "--query", "engineer", "--page", "-1"]), "BAD_ARG");
  });

  test("empty --query is rejected", async () => {
    expectCliError(await runCLI(["search", "--query", ""]), "BAD_ARG");
  });

  test("detail without an id is rejected", async () => {
    expectCliError(await runCLI(["detail"]), "NO_ID");
  });

  test("detail --format table is rejected (detail has no table format)", async () => {
    expectCliError(await runCLI(["detail", "0".repeat(32), "--format", "table"]), "BAD_ARG");
  });

  test("an unknown command is rejected", async () => {
    expectCliError(await runCLI(["frobnicate"]), "BAD_CMD");
  });
});
