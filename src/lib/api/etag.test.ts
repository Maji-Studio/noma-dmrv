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
