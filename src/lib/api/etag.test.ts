import { describe, expect, it } from "vitest";
import { parseIfMatch, representationEtag } from "./etag";

describe("strong representation ETags", () => {
  it("round-trips version and representation revision", () => {
    expect(parseIfMatch(representationEtag(42, 3))).toEqual({ version: 42, revision: 3 });
  });
  it.each([null, "*", 'W/"1.1"'])("requires a strong precondition: %s", (tag) => {
    expect(() => parseIfMatch(tag)).toThrow(expect.objectContaining({ status: 428,
      code: tag === null ? "precondition_required" : "strong_etag_required" }));
  });
  it.each(['"1"', '"0.1"', '"01.1"', '"1.0"', '"1.1", "2.1"', '"9007199254740992.1"', "", "1.1"])("rejects malformed %s", (tag) => {
    expect(() => parseIfMatch(tag)).toThrow(expect.objectContaining({ status: 400, code: "invalid_etag" }));
  });
});

it("publishes a pattern that covers exactly the positive safe integer bounds", async () => {
  const { STRONG_ETAG_PATTERN } = await import("./etag");
  for (const value of [1, 9, 10, 99, 100, Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER]) {
    const tag = representationEtag(value, value);
    expect(STRONG_ETAG_PATTERN.test(tag)).toBe(true);
    expect(parseIfMatch(tag)).toEqual({ version: value, revision: value });
  }
  for (const tag of ['"78.86753729017096108"', '"1.9007199254740992"', '"9007199254740992.1"']) {
    expect(STRONG_ETAG_PATTERN.test(tag)).toBe(false);
    expect(() => parseIfMatch(tag)).toThrow();
  }
});
