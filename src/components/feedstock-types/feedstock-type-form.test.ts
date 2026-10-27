import { describe, expect, it } from "vitest";
import {
  feedstockTypeUsageOptionsFor,
  initialFeedstockTypeUsage,
  isometricLinkAction,
  shouldOverwriteNameOnIsometricSelection,
  shouldClearCategoryForIsometricSelection,
  shouldSetUsageToPyrolysisForIsometricSelection,
  shouldShowCertifiedFeedstockWarning,
  shouldShowIsometricFeedstockSection,
  visibleFeedstockTypeSection,
} from "./feedstock-type-form-logic";

describe("initialFeedstockTypeUsage", () => {
  it("leaves usage unselected for a standalone create form", () => {
    expect(initialFeedstockTypeUsage(undefined, undefined)).toBeUndefined();
  });

  it("uses a parent workflow default when provided", () => {
    expect(initialFeedstockTypeUsage(undefined, "blend")).toBe("blend");
  });

  it("preserves the persisted usage when editing", () => {
    expect(initialFeedstockTypeUsage("pyrolysis", "blend")).toBe("pyrolysis");
  });
});

describe("shouldShowIsometricFeedstockSection", () => {
  it("hides the Isometric section without an Isometric certifier", () => {
    expect(
      shouldShowIsometricFeedstockSection(false, false, undefined),
    ).toBe(false);
    expect(
      shouldShowIsometricFeedstockSection(false, true, "pyrolysis"),
    ).toBe(false);
  });

  it("shows the Isometric section when usage is not locked", () => {
    expect(shouldShowIsometricFeedstockSection(true, false, undefined)).toBe(
      true,
    );
    expect(shouldShowIsometricFeedstockSection(true, false, "blend")).toBe(
      true,
    );
  });

  it("hides the Isometric section when locked to blend usage", () => {
    expect(shouldShowIsometricFeedstockSection(true, true, "blend")).toBe(
      false,
    );
  });

  it("shows the Isometric section when locked to pyrolysis usage", () => {
    expect(shouldShowIsometricFeedstockSection(true, true, "pyrolysis")).toBe(
      true,
    );
  });
});

describe("visibleFeedstockTypeSection", () => {
  it("falls back to General when the Isometric gate closes", () => {
    expect(visibleFeedstockTypeSection("isometric", true)).toBe("isometric");
    expect(visibleFeedstockTypeSection("isometric", false)).toBe("general");
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
  it("hides the warning without an Isometric certifier", () => {
    expect(
      shouldShowCertifiedFeedstockWarning(false, false, "pyrolysis", false),
    ).toBe(false);
  });

  it("hides the warning for Blend in create mode", () => {
    expect(
      shouldShowCertifiedFeedstockWarning(true, false, "blend", false),
    ).toBe(false);
  });

  it("shows the warning for Pyrolysis in create mode without an Isometric selection", () => {
    expect(
      shouldShowCertifiedFeedstockWarning(true, false, "pyrolysis", false),
    ).toBe(true);
  });

  it("hides the warning after selecting an Isometric feedstock", () => {
    expect(
      shouldShowCertifiedFeedstockWarning(true, false, "pyrolysis", true),
    ).toBe(false);
  });

  it("hides the warning in edit mode", () => {
    expect(
      shouldShowCertifiedFeedstockWarning(true, true, "pyrolysis", false),
    ).toBe(false);
  });
});

describe("shouldOverwriteNameOnIsometricSelection", () => {
  it("renames a new type after the registry entry", () => {
    expect(shouldOverwriteNameOnIsometricSelection(false)).toBe(true);
  });

  it("keeps the operator's own name on a saved type", () => {
    expect(shouldOverwriteNameOnIsometricSelection(true)).toBe(false);
  });
});

describe("isometricLinkAction", () => {
  const base = { isEditMode: true, hasIsometricCertifier: true, usage: "pyrolysis" as const, isLinked: false, isLocked: false };

  it("offers a link on an unlinked saved type, even when a Removal is sent", () => {
    expect(isometricLinkAction(base)).toBe("link");
    expect(isometricLinkAction({ ...base, isLocked: true })).toBe("link");
  });

  it("offers a change on an unlocked link and read-only on a locked one", () => {
    expect(isometricLinkAction({ ...base, isLinked: true })).toBe("change");
    expect(isometricLinkAction({ ...base, isLinked: true, isLocked: true })).toBe("locked");
  });

  it("offers nothing for a new type, a blend type or another certifier", () => {
    expect(isometricLinkAction({ ...base, isEditMode: false })).toBeNull();
    expect(isometricLinkAction({ ...base, usage: "blend" })).toBeNull();
    expect(isometricLinkAction({ ...base, hasIsometricCertifier: false })).toBeNull();
  });
});
