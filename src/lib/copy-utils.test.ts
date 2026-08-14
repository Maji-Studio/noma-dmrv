import { describe, expect, it } from "vitest";
import {
  formatCount,
  isMissingValueCopy,
  MISSING_VALUE,
  missingValueCopy,
  missingValueSituation,
  pluralize,
  type MissingValueSituation,
} from "./copy-utils";

describe("MISSING_VALUE vocabulary", () => {
  // These strings are matched verbatim by Playwright specs and by the
  // detail-panel presence backstop. Changing one is a test change, not a
  // wording tweak — see docs/design-system.md.
  it("pins the rendered copy of every situation", () => {
    expect(MISSING_VALUE).toEqual({
      notRecorded: "Not recorded",
      notAvailable: "Not available",
      notApplicable: "Not applicable",
      none: "None",
      notSet: "Not set",
      notYetComputed: "Not yet computed",
    });
  });

  it("names one situation per token and never repeats copy", () => {
    const copies = Object.values(MISSING_VALUE);
    expect(new Set(copies).size).toBe(copies.length);
  });

  it("uses no en dash or em dash as a placeholder", () => {
    for (const copy of Object.values(MISSING_VALUE)) {
      expect(copy).not.toMatch(/[–—]/);
    }
  });
});

describe("missingValueCopy / missingValueSituation", () => {
  const situations = Object.keys(MISSING_VALUE) as MissingValueSituation[];

  it.each(situations)("round-trips %s", (situation) => {
    expect(missingValueSituation(missingValueCopy(situation))).toBe(situation);
  });

  it("returns null for copy outside the vocabulary", () => {
    expect(missingValueSituation("Unassigned")).toBeNull();
    expect(missingValueSituation("not recorded")).toBeNull();
    expect(missingValueSituation("")).toBeNull();
    expect(missingValueSituation(null)).toBeNull();
    expect(missingValueSituation(0)).toBeNull();
  });
});

describe("isMissingValueCopy", () => {
  it("recognises every token, including the blocked/pending one", () => {
    for (const copy of Object.values(MISSING_VALUE)) {
      expect(isMissingValueCopy(copy)).toBe(true);
    }
  });

  it("does not recognise real values or off-vocabulary placeholders", () => {
    expect(isMissingValueCopy("25 km")).toBe(false);
    expect(isMissingValueCopy("Unassigned")).toBe(false);
    expect(isMissingValueCopy("No crop type")).toBe(false);
    expect(isMissingValueCopy(undefined)).toBe(false);
  });
});

describe("pluralize / formatCount", () => {
  it("picks the singular only for exactly one", () => {
    expect(pluralize(1, "bin")).toBe("bin");
    expect(pluralize(0, "bin")).toBe("bins");
    expect(pluralize(2, "bin")).toBe("bins");
    expect(pluralize(2, "batch", "batches")).toBe("batches");
  });

  it("formats a count with its noun", () => {
    expect(formatCount(1, "bin")).toBe("1 bin");
    expect(formatCount(3, "bin")).toBe("3 bins");
  });
});
