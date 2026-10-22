import { describe, expect, it } from "vitest";
import {
  inputUnitLabel,
  MISSING_TEMPLATE_NAME,
  templateName,
  type RemovalTemplateReviewEntry,
} from "./removal-template-review-model";

const DECIDED = { scope: "operating", origin: "reviewed", entryPolicy: "additive" } as const;

/** A review entry as the hook returns it, reduced to the fields readiness reads. */
function entry(overrides: Record<string, unknown> = {}): RemovalTemplateReviewEntry {
  return {
    availability: "listed",
    template: { id: "rvt_1", display_name: "Template", credit_type: "REMOVAL", groups: [] },
    observation: {},
    enrichmentProblems: [],
    lineSourceProblems: [],
    lines: [{ component: { id: "line_a" }, contract: DECIDED }],
    ...overrides,
  } as unknown as RemovalTemplateReviewEntry;
}

describe("templateName", () => {
  it("uses the template's display name", () => {
    expect(templateName(entry())).toBe("Template");
  });

  it("names a template Isometric no longer lists, keeping Isometric capitalised", () => {
    expect(templateName(entry({ availability: "missing", template: null }))).toBe(MISSING_TEMPLATE_NAME);
    expect(MISSING_TEMPLATE_NAME).toBe("Template not found on Isometric");
  });
});

describe("inputUnitLabel", () => {
  it("shows the unit Isometric gave", () => {
    expect(inputUnitLabel({ volume_of_fuel: { unit: "L" } }, "volume_of_fuel")).toBe("L");
  });

  it("says the unit was not read when there is no enrichment", () => {
    expect(inputUnitLabel(undefined, "volume_of_fuel")).toBe("Unit not read");
    expect(inputUnitLabel({}, "volume_of_fuel")).toBe("Unit not read");
  });

  it("says the unit was not read when the input's read failed", () => {
    expect(inputUnitLabel({ volume_of_fuel: { status: "unknown" } }, "volume_of_fuel")).toBe("Unit not read");
  });

  it("says Isometric gives no unit only for an entry it read with an empty unit", () => {
    expect(inputUnitLabel({ volume_of_fuel: { unit: "" } }, "volume_of_fuel")).toBe("Isometric gives no unit");
  });
});
