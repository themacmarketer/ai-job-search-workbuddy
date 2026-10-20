import { describe, expect, test } from "bun:test";
import { normalizeId } from "../src/helpers";

// normalizeId is the guard that stops a pasted apply-link from another site
// being mined for a hex string and silently resolving to an unrelated posting.
// The old failure mode in sibling CLIs was "take the first long number in any
// URL", which fetched whatever the target portal happened to have under it.

const UUID = "74bd2c1381896351e2bae40356b362ea";

describe("normalizeId", () => {
  test("accepts a bare 32-character uuid", () => {
    expect(normalizeId(UUID)).toBe(UUID);
  });

  test("accepts uppercase and normalises to lowercase", () => {
    expect(normalizeId(UUID.toUpperCase())).toBe(UUID);
  });

  test("accepts the short job URL", () => {
    expect(normalizeId(`https://www.mycareersfuture.gov.sg/job/${UUID}`)).toBe(UUID);
  });

  test("accepts the canonical slug URL", () => {
    expect(
      normalizeId(`https://www.mycareersfuture.gov.sg/job/general-management/marketing-manager-${UUID}`),
    ).toBe(UUID);
  });

  test("accepts a trailing slash", () => {
    expect(normalizeId(`https://www.mycareersfuture.gov.sg/job/${UUID}/`)).toBe(UUID);
  });

  test("accepts a URL without a scheme", () => {
    expect(normalizeId(`www.mycareersfuture.gov.sg/job/${UUID}`)).toBe(UUID);
  });

  test("rejects a foreign host even when it contains a 32-hex string", () => {
    expect(normalizeId(`https://boards.greenhouse.io/acme/jobs/${UUID}`)).toBeNull();
  });

  test("rejects a look-alike host", () => {
    expect(normalizeId(`https://mycareersfuture.gov.sg.evil.io/job/${UUID}`)).toBeNull();
  });

  test("rejects a userinfo trick", () => {
    expect(normalizeId(`https://www.mycareersfuture.gov.sg@evil.io/job/${UUID}`)).toBeNull();
  });

  test("rejects a truncated id", () => {
    // The table used to truncate ids to 8 chars, which made copied ids unusable.
    expect(normalizeId("74bd2c13")).toBeNull();
  });

  test("rejects a non-hex uuid-shaped string", () => {
    expect(normalizeId("z".repeat(32))).toBeNull();
  });

  test("rejects an empty string", () => {
    expect(normalizeId("   ")).toBeNull();
  });
});
