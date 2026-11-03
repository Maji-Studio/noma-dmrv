import { describe, expect, it } from "vitest";
import { EXACT_ID_FILTER_MAX } from "@/lib/exact-id-filter";
import { facilityListHref, plural } from "./dashboard-links";

describe("facilityListHref", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, index) => `id-${index}`);

  it("filters to the ids while they fit the list's limit", () => {
    expect(facilityListHref("/applications", "f1", ids(2))).toBe("/applications?facility=f1&ids=id-0%2Cid-1");
    expect(facilityListHref("/applications", "f1", ids(EXACT_ID_FILTER_MAX))).toContain("&ids=");
  });

  it("opens the plain list past the limit or without ids", () => {
    expect(facilityListHref("/applications", "f1", ids(EXACT_ID_FILTER_MAX + 1))).toBe("/applications?facility=f1");
    expect(facilityListHref("/applications", "f1")).toBe("/applications?facility=f1");
  });
});

describe("plural", () => {
  it("uses the singular for one and the given plural for irregular words", () => {
    expect(plural(1, "run")).toBe("1 run");
    expect(plural(3, "run")).toBe("3 runs");
    expect(plural(2, "delivery", "deliveries")).toBe("2 deliveries");
  });
});
