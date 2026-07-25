import { describe, expect, it } from "vitest";
import {
  feedstockTypeUsageOptionsFor,
  shouldClearCategoryForIsometricSelection,
  shouldSetUsageToPyrolysisForIsometricSelection,
  shouldShowCertifiedFeedstockWarning,
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

describe("shouldShowCertifiedFeedstockWarning", () => {
  it("hides the warning for Blend in create mode", () => {
    expect(
      shouldShowCertifiedFeedstockWarning(false, "blend", false),
    ).toBe(false);
  });

  it("shows the warning for Pyrolysis in create mode without an Isometric selection", () => {
    expect(
      shouldShowCertifiedFeedstockWarning(false, "pyrolysis", false),
    ).toBe(true);
  });

  it("hides the warning after selecting an Isometric feedstock", () => {
    expect(
      shouldShowCertifiedFeedstockWarning(false, "pyrolysis", true),
    ).toBe(false);
  });

  it("hides the warning in edit mode", () => {
    expect(
      shouldShowCertifiedFeedstockWarning(true, "pyrolysis", false),
    ).toBe(false);
  });
});
