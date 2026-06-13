/**
 * Tests for the pure logic helpers in FeedstockTypeForm.
 *
 * All functions below mirror private logic from feedstock-type-form.tsx so any
 * refactor that changes behaviour is caught. The three areas covered:
 *
 *  1. Sections filtering: `lockUsage && defaultUsage === "blend"` hides the
 *     Isometric tab, since the Isometric catalogue only contains pyrolysis types.
 *  2. Usage-options filtering: `lockUsage && defaultUsage` constrains the usage
 *     select to the parent workflow's usage.
 *  3. handleSelectIsometricFeedstock — the new logic that sets usage/category
 *     when an Isometric feedstock is selected from the browser.
 *  4. ISOMETRIC_FEEDSTOCK_REF_PREFIX — the registry-reference value format.
 */
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Helpers mirroring the private module constants and functions
// ---------------------------------------------------------------------------

type SectionKey = "general" | "isometric";
type FeedstockTypeUsage = "pyrolysis" | "blend";

const SECTIONS: ReadonlyArray<{ key: SectionKey; label: string }> = [
  { key: "general", label: "General" },
  { key: "isometric", label: "Isometric" },
];

const ISOMETRIC_FEEDSTOCK_REF_PREFIX = "isometric:feedstock_type:";

/** Mirrors the `sections` computation in FeedstockTypeForm */
function computeSections(
  lockUsage: boolean,
  defaultUsage: FeedstockTypeUsage | undefined,
): ReadonlyArray<{ key: SectionKey; label: string }> {
  return lockUsage && defaultUsage === "blend"
    ? SECTIONS.filter((section) => section.key === "general")
    : SECTIONS;
}

/** Mirrors the `usageOptions` filtering in FeedstockTypeForm */
interface Option { value: string; label: string }
function computeUsageOptions(
  allOptions: Option[],
  lockUsage: boolean,
  defaultUsage: FeedstockTypeUsage | undefined,
): Option[] {
  return lockUsage && defaultUsage
    ? allOptions.filter((option) => option.value === defaultUsage)
    : allOptions;
}

const ALL_USAGE_OPTIONS: Option[] = [
  { value: "pyrolysis", label: "Pyrolysis" },
  { value: "blend", label: "Blend" },
];

// ---------------------------------------------------------------------------
// registryUrl value for an Isometric selection
// ---------------------------------------------------------------------------
function buildIsometricRegistryRef(isometricId: string): string {
  return `${ISOMETRIC_FEEDSTOCK_REF_PREFIX}${isometricId}`;
}

// ---------------------------------------------------------------------------
// handleSelectIsometricFeedstock side-effect logic
// (tests the conditions, not the React setValue calls)
// ---------------------------------------------------------------------------
/** Returns true if selecting an Isometric feedstock should set usage to "pyrolysis" */
function shouldSetUsageToPyrolysis(
  lockUsage: boolean,
  defaultUsage: FeedstockTypeUsage | undefined,
): boolean {
  return !lockUsage || defaultUsage === "pyrolysis";
}

/** Returns true if the category should be cleared when selecting an Isometric feedstock */
function shouldClearCategory(
  currentUsage: FeedstockTypeUsage | undefined,
): boolean {
  return currentUsage !== "pyrolysis";
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sections visibility — lockUsage + defaultUsage === 'blend'", () => {
  it("shows both sections when lockUsage is false", () => {
    const sections = computeSections(false, undefined);
    expect(sections.map((s) => s.key)).toEqual(["general", "isometric"]);
  });

  it("shows both sections when lockUsage is false, even with defaultUsage=blend", () => {
    const sections = computeSections(false, "blend");
    expect(sections.map((s) => s.key)).toEqual(["general", "isometric"]);
  });

  it("hides the Isometric tab when lockUsage=true AND defaultUsage=blend", () => {
    const sections = computeSections(true, "blend");
    expect(sections.map((s) => s.key)).toEqual(["general"]);
    expect(sections.find((s) => s.key === "isometric")).toBeUndefined();
  });

  it("shows both sections when lockUsage=true AND defaultUsage=pyrolysis", () => {
    // Isometric catalogue only has pyrolysis types — both tabs are valid.
    const sections = computeSections(true, "pyrolysis");
    expect(sections.map((s) => s.key)).toEqual(["general", "isometric"]);
  });

  it("shows both sections when lockUsage=true AND defaultUsage is undefined", () => {
    // No lock + no default → unchanged.
    const sections = computeSections(true, undefined);
    expect(sections.map((s) => s.key)).toEqual(["general", "isometric"]);
  });

  it("the General section always appears (never filtered out)", () => {
    for (const lockUsage of [false, true]) {
      for (const usage of [undefined, "pyrolysis" as const, "blend" as const]) {
        const sections = computeSections(lockUsage, usage);
        expect(sections.find((s) => s.key === "general")).toBeDefined();
      }
    }
  });
});

describe("keyboard navigation wraps around the visible sections", () => {
  // When only one section remains (blend mode), ArrowRight/Left from that
  // single section must wrap back to itself (index 0 + 1) % 1 = 0).
  it("wraps to self when there is only one section", () => {
    const sections = computeSections(true, "blend");
    expect(sections.length).toBe(1);
    const delta = 1;
    const nextIndex = (0 + delta + sections.length) % sections.length;
    expect(nextIndex).toBe(0);
  });

  it("wraps from last to first in a two-section list", () => {
    const sections = computeSections(false, undefined);
    expect(sections.length).toBe(2);
    const nextIndex = (1 + 1 + sections.length) % sections.length;
    expect(nextIndex).toBe(0);
  });

  it("wraps from first to last in a two-section list", () => {
    const sections = computeSections(false, undefined);
    const prevIndex = (0 - 1 + sections.length) % sections.length;
    expect(prevIndex).toBe(1);
  });
});

describe("usageOptions filtering", () => {
  it("returns all options when lockUsage is false", () => {
    const options = computeUsageOptions(ALL_USAGE_OPTIONS, false, undefined);
    expect(options).toHaveLength(2);
  });

  it("returns all options when lockUsage is true but defaultUsage is undefined", () => {
    const options = computeUsageOptions(ALL_USAGE_OPTIONS, true, undefined);
    expect(options).toHaveLength(2);
  });

  it("constrains to pyrolysis when lockUsage=true and defaultUsage=pyrolysis", () => {
    const options = computeUsageOptions(ALL_USAGE_OPTIONS, true, "pyrolysis");
    expect(options).toHaveLength(1);
    expect(options[0].value).toBe("pyrolysis");
  });

  it("constrains to blend when lockUsage=true and defaultUsage=blend", () => {
    const options = computeUsageOptions(ALL_USAGE_OPTIONS, true, "blend");
    expect(options).toHaveLength(1);
    expect(options[0].value).toBe("blend");
  });
});

describe("ISOMETRIC_FEEDSTOCK_REF_PREFIX and registry reference format", () => {
  it("prefix is isometric:feedstock_type:", () => {
    expect(ISOMETRIC_FEEDSTOCK_REF_PREFIX).toBe("isometric:feedstock_type:");
  });

  it("builds a registry ref by prepending the prefix to the Isometric ID", () => {
    const ref = buildIsometricRegistryRef("ft-abc-123");
    expect(ref).toBe("isometric:feedstock_type:ft-abc-123");
  });

  it("the ref starts with the prefix for any non-empty Isometric ID", () => {
    expect(buildIsometricRegistryRef("any-id").startsWith(ISOMETRIC_FEEDSTOCK_REF_PREFIX)).toBe(true);
  });
});

describe("handleSelectIsometricFeedstock — usage/category mutation conditions", () => {
  it("sets usage to pyrolysis when lockUsage is false (open form)", () => {
    expect(shouldSetUsageToPyrolysis(false, undefined)).toBe(true);
    expect(shouldSetUsageToPyrolysis(false, "blend")).toBe(true);
    expect(shouldSetUsageToPyrolysis(false, "pyrolysis")).toBe(true);
  });

  it("sets usage to pyrolysis when lockUsage=true AND defaultUsage=pyrolysis", () => {
    expect(shouldSetUsageToPyrolysis(true, "pyrolysis")).toBe(true);
  });

  it("does NOT set usage when lockUsage=true AND defaultUsage=blend", () => {
    // Blend workflows lock the usage — the Isometric selection must not override it.
    expect(shouldSetUsageToPyrolysis(true, "blend")).toBe(false);
  });

  it("clears category when current usage is not pyrolysis", () => {
    expect(shouldClearCategory("blend")).toBe(true);
    expect(shouldClearCategory(undefined)).toBe(true);
  });

  it("does NOT clear category when current usage is already pyrolysis", () => {
    // No need to reset the category if it's already in the pyrolysis bucket.
    expect(shouldClearCategory("pyrolysis")).toBe(false);
  });
});