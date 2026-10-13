import { describe, expect, it } from "vitest";
import { bodyHashEtag, parseIfMatch, representationEtag, STRONG_ETAG_PATTERN } from "./etag";

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

describe("body hash ETags", () => {
  const data = { storageLocationId: "bin", totals: { dryBiocharKg: 1.5, estimatedWetKg: null }, subBins: [{ layerId: "a" }, { layerId: "b" }] };

  it("is a strong sha256 tag of the revision and body", () => {
    expect(bodyHashEtag(1, data)).toMatch(/^"sha256-[A-Za-z0-9_-]{43}"$/);
    expect(bodyHashEtag(1, data)).toBe(bodyHashEtag(1, structuredClone(data)));
    expect(bodyHashEtag(2, data)).not.toBe(bodyHashEtag(1, data));
  });

  it("ignores key order and keeps array order", () => {
    const reordered = { subBins: data.subBins, totals: { estimatedWetKg: null, dryBiocharKg: 1.5 }, storageLocationId: "bin" };
    expect(bodyHashEtag(1, reordered)).toBe(bodyHashEtag(1, data));
    expect(bodyHashEtag(1, { ...data, subBins: [...data.subBins].reverse() })).not.toBe(bodyHashEtag(1, data));
  });

  it("changes with any published value, null included", () => {
    expect(bodyHashEtag(1, { ...data, totals: { dryBiocharKg: 1.5, estimatedWetKg: 0 } })).not.toBe(bodyHashEtag(1, data));
  });

  it("is never a version tag, so If-Match refuses it", () => {
    const tag = bodyHashEtag(1, data);
    expect(STRONG_ETAG_PATTERN.test(tag)).toBe(false);
    expect(() => parseIfMatch(tag)).toThrow(expect.objectContaining({ status: 400, code: "invalid_etag" }));
  });

  it("refuses a body that has no canonical JSON", () => {
    expect(() => bodyHashEtag(1, { value: Number.NaN })).toThrow();
  });
});
