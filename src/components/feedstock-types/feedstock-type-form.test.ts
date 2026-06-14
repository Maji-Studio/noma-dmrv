import { describe, expect, it } from "vitest";
import {
  feedstockTypeUsageOptionsFor,
  ISOMETRIC_FEEDSTOCK_REF_PREFIX,
  isometricFeedstockRegistryRef,
  shouldClearCategoryForIsometricSelection,
  shouldSetUsageToPyrolysisForIsometricSelection,
  shouldShowIsometricFeedstockSection,
} from "./feedstock-type-form-logic";

describe("shouldShowIsometricFeedstockSection", () => {
  it("shows the Isometric section when usage is not locked", () => {
    expect(shouldShowIsometricFeedstockSection(false, undefined)).toBe(true);
    expect(shouldShowIsometricFeedstockSection(false, "blend")).toBe(true);
  });

  it("hides the Isometric section when locked to blend usage", () => {
    expect(shouldShowIsometricFeedstockSection(true, "blend")).toBe(false);
  });

  it("shows the Isometric section when locked to pyrolysis usage", () => {
    expect(shouldShowIsometricFeedstockSection(true, "pyrolysis")).toBe(true);
  });
});

describe("feedstockTypeUsageOptionsFor", () => {
  it("returns all options when lockUsage is false", () => {
    const options = feedstockTypeUsageOptionsFor(false, undefined);
    expect(options).toHaveLength(2);
  });

  it("returns all options when lockUsage is true but defaultUsage is undefined", () => {
    const options = feedstockTypeUsageOptionsFor(true, undefined);
    expect(options).toHaveLength(2);
  });

  it("constrains to pyrolysis when lockUsage=true and defaultUsage=pyrolysis", () => {
    const options = feedstockTypeUsageOptionsFor(true, "pyrolysis");
    expect(options).toHaveLength(1);
    expect(options[0].value).toBe("pyrolysis");
  });

  it("constrains to blend when lockUsage=true and defaultUsage=blend", () => {
    const options = feedstockTypeUsageOptionsFor(true, "blend");
    expect(options).toHaveLength(1);
    expect(options[0].value).toBe("blend");
  });
});

describe("ISOMETRIC_FEEDSTOCK_REF_PREFIX and registry reference format", () => {
  it("prefix is isometric:feedstock_type:", () => {
    expect(ISOMETRIC_FEEDSTOCK_REF_PREFIX).toBe("isometric:feedstock_type:");
  });

  it("builds a registry ref by prepending the prefix to the Isometric ID", () => {
    const ref = isometricFeedstockRegistryRef("ft-abc-123");
    expect(ref).toBe("isometric:feedstock_type:ft-abc-123");
  });

  it("the ref starts with the prefix for any non-empty Isometric ID", () => {
    expect(
      isometricFeedstockRegistryRef("any-id").startsWith(
        ISOMETRIC_FEEDSTOCK_REF_PREFIX,
      ),
    ).toBe(true);
  });
});

describe("handleSelectIsometricFeedstock — usage/category mutation conditions", () => {
  it("sets usage to pyrolysis when lockUsage is false (open form)", () => {
    expect(
      shouldSetUsageToPyrolysisForIsometricSelection(false, undefined),
    ).toBe(true);
    expect(shouldSetUsageToPyrolysisForIsometricSelection(false, "blend")).toBe(
      true,
    );
    expect(
      shouldSetUsageToPyrolysisForIsometricSelection(false, "pyrolysis"),
    ).toBe(true);
  });

  it("sets usage to pyrolysis when lockUsage=true AND defaultUsage=pyrolysis", () => {
    expect(
      shouldSetUsageToPyrolysisForIsometricSelection(true, "pyrolysis"),
    ).toBe(true);
  });

  it("does NOT set usage when lockUsage=true AND defaultUsage=blend", () => {
    expect(shouldSetUsageToPyrolysisForIsometricSelection(true, "blend")).toBe(
      false,
    );
  });

  it("clears category when current usage is not pyrolysis", () => {
    expect(shouldClearCategoryForIsometricSelection("blend")).toBe(true);
    expect(shouldClearCategoryForIsometricSelection(undefined)).toBe(true);
  });

  it("does NOT clear category when current usage is already pyrolysis", () => {
    expect(shouldClearCategoryForIsometricSelection("pyrolysis")).toBe(false);
  });
});
