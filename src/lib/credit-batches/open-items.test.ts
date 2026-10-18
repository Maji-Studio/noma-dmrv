import { describe, expect, it } from "vitest";
import type { CreditBatchPageModel } from "@/data-access/credit-batch-page-model";
import {
  H_TO_C_ORG_ELIGIBILITY_MAX,
  O_TO_C_ORG_ELIGIBILITY_MAX,
} from "@/lib/calculations/biochar-eligibility";
import {
  buildDurabilityBatchSummaries,
  type DurabilitySummaryReplicate,
} from "@/lib/certification/durability-batch-summary";
import { batchHealthFixLinkFor } from "@/lib/certification/batch-health-links";
import { sampleDocumentWarnings } from "@/lib/certification/sample-document-warnings";
import type { BatchHealthFixTarget } from "@/lib/certification/batch-health";
import {
  buildCreditBatchOpenItems,
  CREDIT_BATCH_DETAILS_ROW,
  CREDIT_BATCH_TEMPLATE_ROW,
} from "./open-items";

const batchContext = { facilityId: "facility", creditBatchId: "batch" };

function fixture() {
  const [durability] = buildDurabilityBatchSummaries([{
    creditBatchId: "batch",
    creditBatchCode: "CB-1",
    sampling: "sampled",
    runs: [],
    samples: [],
  }]);
  return { ...batchContext, durability };
}

function replicate(overrides: Partial<DurabilitySummaryReplicate> = {}): DurabilitySummaryReplicate {
  return {
    id: "sample",
    sampleCode: "SAM-26-002",
    outlier: true,
    productionRunId: null,
    productionRunCode: null,
    samplingDay: null,
    labName: null,
    hToCorg: null,
    oToCorg: null,
    totalCarbonPercent: null,
    organicCarbonPercent: null,
    ...overrides,
  };
}

function pageModel(): CreditBatchPageModel {
  return {
    creditBatchId: "batch",
    facilityId: "facility",
    slices: [],
    removals: [],
    mass: {
      producedDryKg: 100,
      appliedDryKg: 50,
      inSubmittedDryKg: 0,
      inDraftDryKg: 0,
      notInRemovalDryKg: 50,
      notAppliedDryKg: 50,
    },
    milestones: {
      firstRemovalSubmittedAt: null,
      firstRemovalSubmittedCode: null,
      ghgStatement: {
        id: "statement",
        reportingPeriodStartOn: null,
        reportingPeriodEndOn: "2026-06-30",
        hasMissingPeriod: false,
        status: "in-verification",
        submittedToVerifierAt: null,
        creditsIssuedAt: null,
      },
    },
  };
}

describe("buildCreditBatchOpenItems", () => {
  it("keeps absent sources empty", () => {
    expect(buildCreditBatchOpenItems(batchContext)).toEqual({
      blocking: [],
      check: [],
      waiting: [],
    });
  });

  it("uses requirement wording and routes local fixes and external records", () => {
    const result = buildCreditBatchOpenItems({ ...batchContext,
      health: {
        state: "incomplete",
        issueCount: 4,
        checks: [
          {
            key: "carbon",
            label: "Carbon",
            requirementLabel: "Sample data complete",
            status: "unmet",
          },
          {
            key: "emissions",
            label: "Emissions",
            requirementLabel: "Emissions recorded",
            status: "unmet",
          },
          {
            key: "template",
            label: "Template",
            requirementLabel: "Template resolved",
            status: "unmet",
          },
          {
            key: "transport",
            label: "Transport",
            requirementLabel: "Distances recorded",
            status: "unmet",
            affectedRecords: [{
              id: "location",
              code: "L-1",
              missing: ["distance"],
              href: "/customers?location=location",
            }],
          },
          {
            key: "production",
            label: "Production",
            requirementLabel: "Production linked",
            status: "met",
          },
        ],
      },
    });
    expect(result.blocking.map(row => [row.title, row.target])).toEqual([
      ["Sample data complete", { tab: "samples" }],
      ["Emissions recorded", { tab: "emissions" }],
      ["Template resolved", { href: "/certification/settings?section=removal-templates&facility=facility" }],
      ["Distances recorded", { href: "/customers?location=location" }],
    ]);
  });

  it("lists Sample document warnings as Check items on the Samples tab", () => {
    const warnings = sampleDocumentWarnings({
      sampling: "sampled", creditBatchCode: "CB-1", hasLabReport: false,
      hasReflectanceHistogram: false, durabilityOption: "1000_year",
    });
    const result = buildCreditBatchOpenItems({ ...batchContext,
      health: { state: "ready", issueCount: 0, checks: [], warnings: [...warnings, warnings[0], "Another hint."] } });
    expect(result.blocking).toEqual([]);
    expect(result.check.map(item => [item.id, item.title, item.target])).toEqual([
      ["document:lab-report", "No lab report on any Sample", { tab: "samples" }],
      ["document:reflectance-histogram", "No reflectance histogram on any Sample", { tab: "samples" }],
      ["document:Another hint.", "Another hint.", { tab: "samples" }],
    ]);
  });

  it("keeps a requirement's reasoning for its ⓘ", () => {
    const result = buildCreditBatchOpenItems({ ...batchContext, health: { state: "incomplete", issueCount: 1, checks: [{
      key: "production", label: "Production", requirementLabel: "Linked production data", status: "unmet",
      whyDetail: "Every applied tonne traces to a production run.",
    }] } });
    expect(result.blocking[0].why).toBe("Every applied tonne traces to a production run.");
  });

  it.each<BatchHealthFixTarget>([
    "creditBatchTemplate", "batchDetails", "labSamples", "emissions",
    "templateLineReview", "certificationTemplates", "certificationEmissions", "productionRuns",
  ])("preserves the repair destination for %s", fixTarget => {
    const check = { key: "template" as const, label: "Template", requirementLabel: "Template ready",
      status: "unmet" as const, fixTarget };
    const localTargets = {
      creditBatchTemplate: { tab: "overview", rowId: CREDIT_BATCH_TEMPLATE_ROW },
      batchDetails: { tab: "overview", rowId: CREDIT_BATCH_DETAILS_ROW },
      labSamples: { tab: "samples" },
      emissions: { tab: "emissions" },
    };
    const local = localTargets[fixTarget as keyof typeof localTargets];
    const result = buildCreditBatchOpenItems({ ...batchContext, pageModel: pageModel(),
      health: { state: "incomplete", issueCount: 1, checks: [check] } });
    expect(result.blocking[0].target).toEqual(local ?? {
      href: batchHealthFixLinkFor(check, "facility", "batch").href,
    });
  });

  it.each<BatchHealthFixTarget>([
    "templateLineReview", "certificationTemplates", "certificationEmissions", "emissions",
  ])("routes emission review to %s", fixTarget => {
    const result = buildCreditBatchOpenItems({ ...batchContext, emissionLines: [{
      componentId: "diesel", displayName: "Diesel", state: "needsReview", groupKey: "production",
      blueprintKey: "production", contract: undefined, automaticFigure: null, entries: [], total: null,
      blocker: { code: "lineNeedsReview", message: "Review this line", fixTarget },
    }] });
    expect(result.check[0].target).toEqual(fixTarget === "emissions"
      ? { tab: "emissions", rowId: "diesel" }
      : { href: batchHealthFixLinkFor({ key: "emissions", fixTarget }, "facility", "batch").href });
  });

  it("groups threshold, pairing, emission review and waiting items", () => {
    const input = {
      ...fixture(),
      pageModel: pageModel(),
      emissionLines: [{
        componentId: "diesel",
        displayName: "Diesel",
        state: "needsReview" as const,
        groupKey: "production",
        blueprintKey: "production",
        contract: undefined,
        automaticFigure: null,
        entries: [],
        total: null,
      }],
    };
    input.durability.replicates = [replicate({ hToCorg: 0.7 })];
    input.durability.eligibility.unpairedHToCSampleCodes = ["SAM-26-002"];
    const result = buildCreditBatchOpenItems(input);
    expect(result.check.map(row => row.id)).toEqual([
      "outlier:SAM-26-002",
      "unpaired:SAM-26-002",
      "emission:diesel",
    ]);
    expect(result.check[0]).toMatchObject({
      title: `Sample SAM-26-002: H/Corg above the ${H_TO_C_ORG_ELIGIBILITY_MAX} limit`,
      target: { tab: "samples", rowId: "sample" },
    });
    expect(result.waiting).toEqual([
      {
        id: "verification:statement",
        title: "GHG Statement Ends Jun 30, 2026: In verification",
        target: { tab: "removals" },
      },
      {
        id: "not-applied",
        title: "0.05 t produced but not applied yet",
        detail: "It can join a Removal once its application is recorded.",
        target: { tab: "removals" },
      },
    ]);
    input.pageModel.mass.notAppliedDryKg = null;
    input.pageModel.milestones.ghgStatement!.status = "verified";
    expect(buildCreditBatchOpenItems(input).waiting).toEqual([]);
  });

  it.each([
    {
      hToCorg: H_TO_C_ORG_ELIGIBILITY_MAX,
      oToCorg: null,
      title: `H/Corg at the ${H_TO_C_ORG_ELIGIBILITY_MAX} limit`,
    },
    {
      hToCorg: null,
      oToCorg: O_TO_C_ORG_ELIGIBILITY_MAX,
      title: `O/Corg at the ${O_TO_C_ORG_ELIGIBILITY_MAX} limit`,
    },
    {
      hToCorg: null,
      oToCorg: 0.3,
      title: `O/Corg above the ${O_TO_C_ORG_ELIGIBILITY_MAX} limit`,
    },
    {
      hToCorg: 0.7,
      oToCorg: 0.3,
      title: `H/Corg above the ${H_TO_C_ORG_ELIGIBILITY_MAX} limit and O/Corg above the ${O_TO_C_ORG_ELIGIBILITY_MAX} limit`,
    },
  ])("names the ratio and limit: $title", ({ hToCorg, oToCorg, title }) => {
    const input = fixture();
    input.durability.replicates = [replicate({ hToCorg, oToCorg })];
    expect(buildCreditBatchOpenItems(input).check[0].title).toBe(`Sample SAM-26-002: ${title}`);
  });

  it("uses general durability wording when a flagged Sample has no usable ratios", () => {
    const input = fixture();
    input.durability.replicates = [replicate()];
    expect(buildCreditBatchOpenItems(input).check[0].title)
      .toBe("Sample SAM-26-002 is outside the durability limits");
  });

  it("keeps one item per outlier Sample and skips unflagged Samples", () => {
    const input = fixture();
    input.durability.replicates = [
      replicate({ hToCorg: 0.7 }),
      replicate({ id: "duplicate", hToCorg: 0.7 }),
      replicate({ id: "unflagged", sampleCode: "SAM-26-003", outlier: false }),
    ];
    expect(buildCreditBatchOpenItems(input).check).toHaveLength(1);
  });

  it.each([null, 0, 0.001, 4.999])("omits the unapplied item for %s dry kg", notAppliedDryKg => {
    const model = pageModel();
    model.mass.notAppliedDryKg = notAppliedDryKg;
    model.milestones.ghgStatement = null;
    expect(buildCreditBatchOpenItems({ ...batchContext, pageModel: model }).waiting).toEqual([]);
  });

  it.each([5, 5.001])("shows the unapplied item at the visible threshold for %s dry kg", notAppliedDryKg => {
    const model = pageModel();
    model.mass.notAppliedDryKg = notAppliedDryKg;
    model.milestones.ghgStatement = null;
    expect(buildCreditBatchOpenItems({ ...batchContext, pageModel: model }).waiting).toEqual([{
      id: "not-applied",
      title: "0.01 t produced but not applied yet",
      detail: "It can join a Removal once its application is recorded.",
      target: { tab: "removals" },
    }]);
  });

  it.each([
    {
      reportingPeriodStartOn: "2026-01-01",
      hasMissingPeriod: false,
      title: "GHG Statement Jan 1 to Jun 30, 2026: In verification",
    },
    {
      reportingPeriodStartOn: "2026-01-01",
      hasMissingPeriod: true,
      title: "GHG Statement No period set: In verification",
    },
  ])("formats the waiting period: $title", ({ title, ...period }) => {
    const model = pageModel();
    Object.assign(model.milestones.ghgStatement!, period);
    expect(buildCreditBatchOpenItems({ ...batchContext, pageModel: model }).waiting[0].title).toBe(title);
  });
});
