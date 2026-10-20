import { describe, expect, it } from "vitest";
import {
  MISSING_TEMPLATE_NAME,
  NOT_SET_UP_TITLE,
  templateName,
  templateReadiness,
  TEMPLATE_NOT_FULLY_READ_TITLE,
  type RemovalTemplateReviewEntry,
} from "./removal-template-review-model";

const DECIDED = { scope: "operating", origin: "reviewed", entryPolicy: "additive" } as const;
const PROPOSED = { scope: "operating", origin: "proposed", entryPolicy: "additive" } as const;

/** A review entry as the hook returns it, reduced to the fields readiness reads. */
function entry(overrides: Record<string, unknown> = {}): RemovalTemplateReviewEntry {
  return {
    availability: "listed",
    template: { id: "rvt_1", display_name: "Template", credit_type: "REMOVAL" },
    observation: {},
    enrichmentProblems: [],
    lineSourceProblems: [],
    lines: [{ component: { id: "line_a" }, contract: DECIDED }],
    ...overrides,
  } as unknown as RemovalTemplateReviewEntry;
}

describe("templateReadiness", () => {
  it("marks a template read in full with every line decided as ready", () => {
    expect(templateReadiness(entry())).toEqual({ ready: true });
  });

  it("counts the lines still to decide", () => {
    const lines = [
      { component: { id: "line_a" }, contract: DECIDED },
      { component: { id: "line_b" }, contract: PROPOSED },
      { component: { id: "line_c" }, contract: undefined },
    ];
    expect(templateReadiness(entry({ lines }))).toEqual({ ready: false, reason: "2 components to decide", toDecide: 2 });
  });

  it("names a template not read in full when no line is waiting", () => {
    const problems = [{ code: "unknown-enrichment", componentId: "line_a", inputKey: "volume" }];
    expect(templateReadiness(entry({ enrichmentProblems: problems })))
      .toEqual({ ready: false, reason: TEMPLATE_NOT_FULLY_READ_TITLE });
  });

  it("calls a preview with no stored read not set up yet", () => {
    expect(templateReadiness(entry({ observation: null, preview: true, lines: [] })))
      .toEqual({ ready: false, reason: NOT_SET_UP_TITLE });
  });
});

describe("templateName", () => {
  it("uses the template's display name", () => {
    expect(templateName(entry())).toBe("Template");
  });

  it("names a template Isometric no longer lists, keeping Isometric capitalised", () => {
    expect(templateName(entry({ availability: "missing", template: null }))).toBe(MISSING_TEMPLATE_NAME);
    expect(MISSING_TEMPLATE_NAME).toBe("Template not found on Isometric");
  });
});
