import { describe, expect, it } from "vitest";
import { canonicalUuid } from "./canonical-uuid";
import { lookupIdentifier } from "./lookup-query";
import { parseQueryInput } from "./query";
import { biocharProductListSchema, facilityLookupGetSchema, productionRunListSchema } from "./query-schemas";

const UPPER = "A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11";
const LOWER = UPPER.toLowerCase();

describe("API UUID canonicalization (api/uuid-case)", () => {
  it("lowercases a path or tool target UUID and refuses anything else", () => {
    expect(canonicalUuid(UPPER)).toBe(LOWER);
    expect(canonicalUuid(LOWER)).toBe(LOWER);
    expect(canonicalUuid("BIN-26-001")).toBeUndefined();
  });

  it("reads an uppercase id path segment as the lowercase id, and a code unchanged", () => {
    expect(lookupIdentifier(UPPER)).toEqual({ id: LOWER });
    expect(lookupIdentifier("BIN-26-001")).toEqual({ code: "BIN-26-001" });
  });

  it("lowercases UUID query filters, so cursors bind one spelling", () => {
    expect(parseQueryInput({ facilityId: UPPER, storageLocationId: UPPER, formulationId: UPPER }, biocharProductListSchema))
      .toMatchObject({ facilityId: LOWER, storageLocationId: LOWER, formulationId: LOWER });
    expect(parseQueryInput({ facilityId: UPPER, reactorId: UPPER }, productionRunListSchema)).toMatchObject({ facilityId: LOWER, reactorId: LOWER });
    expect(parseQueryInput({ facilityId: UPPER }, facilityLookupGetSchema)).toEqual({ facilityId: LOWER });
  });
});
