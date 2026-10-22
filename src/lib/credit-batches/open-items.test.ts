import { describe, expect, it } from "vitest";
import type { Sample } from "@/db/schema";
import {
  H_TO_C_ORG_ELIGIBILITY_MAX,
  O_TO_C_ORG_ELIGIBILITY_MAX,
} from "@/lib/calculations/biochar-eligibility";
import {
  buildDurabilityBatchSummaries,
  type DurabilitySummaryReplicate,
} from "@/lib/certification/durability-batch-summary";
import { batchHealthFixLinkFor } from "@/lib/certification/batch-health-links";
import { sampleDocumentWarningKeys } from "@/lib/certification/sample-document-warnings";
import type { BatchHealthFixTarget } from "@/lib/certification/batch-health";
import {
  buildCreditBatchOpenItems,
  CREDIT_BATCH_DETAILS_ROW,
} from "./open-items";

const batchContext = { facilityId: "facility", creditBatchId: "batch", canManage: true };

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

const STATEMENT = { id: "statement-1", status: "FAILED_VERIFICATION" as const, reportingPeriodStartOn: "2026-07-01", reportingPeriodEndOn: "2026-09-30" };
const returnedHealth = (correction: object) => ({
  state: "ready", issueCount: 0, checks: [], removalCorrections: [correction],
}) as never;

describe("buildCreditBatchOpenItems", () => {
  it("opens the Removal for a returned Removal whose sent components changed on this batch", () => {
    const { check } = buildCreditBatchOpenItems({ ...batchContext, health: returnedHealth({
      removalId: "removal-1", removalCode: "RM-26-003", windowOpen: true, resubmitNeeded: true, statement: STATEMENT,
      batches: [{ id: "batch", code: "CB-1" }],
      changed: [
        { componentId: "a", componentName: "Diesel use", batchId: "batch", batchCode: "CB-1" },
        { componentId: "b", componentName: "Transport to field", batchId: "batch", batchCode: "CB-1" },
        { componentId: "a", componentName: "Diesel use", batchId: "batch", batchCode: "CB-1" },
      ],
    }) });
    expect(check).toEqual([{
      id: "correction:removal-1",
      title: "RM-26-003: Resubmit needed",
      detail: "Diesel use and Transport to field changed here since RM-26-003 was sent. Resubmit the Removal to send them.",
      target: { href: "/certification/removals?facility=facility&removal=removal-1" },
    }]);
  });

  it("says send it for a single changed component", () => {
    const [item] = buildCreditBatchOpenItems({ ...batchContext, health: returnedHealth({
      removalId: "removal-1", removalCode: "RM-26-003", windowOpen: true, resubmitNeeded: true, statement: STATEMENT,
      batches: [{ id: "batch", code: "CB-1" }],
      changed: [{ componentId: "a", componentName: "Diesel use", batchId: "batch", batchCode: "CB-1" }],
    }) }).check;
    expect(item.detail).toBe("Diesel use changed here since RM-26-003 was sent. Resubmit the Removal to send it.");
  });

  it("uses records or files copy when no changed component is attributed here", () => {
    const [item] = buildCreditBatchOpenItems({ ...batchContext, health: returnedHealth({
      removalId: "removal-1", removalCode: "RM-26-003", windowOpen: true, resubmitNeeded: true, statement: STATEMENT,
      batches: [{ id: "batch", code: "CB-1" }, { id: "other", code: "CB-2" }], changed: [],
    }) }).check;
    expect(item.title).toBe("RM-26-003: Resubmit needed");
    expect(item.detail).toBe("Records or files changed since RM-26-003 was sent. Resubmit the Removal to send the changes.");
  });

  it.each([
    ["FAILED_VERIFICATION", "GHG Statement Jul 1 to Sep 30, 2026 failed verification."],
    ["DRAFT", "GHG Statement Jul 1 to Sep 30, 2026 is back in draft."],
  ] as const)("sends a returned Removal with nothing changed to the Emissions tab: %s", (status, phrase) => {
    const { check } = buildCreditBatchOpenItems({ ...batchContext, health: returnedHealth({
      removalId: "removal-1", removalCode: "RM-26-003", windowOpen: true, resubmitNeeded: false,
      statement: { ...STATEMENT, status }, batches: [{ id: "batch", code: "CB-1" }], changed: [],
    }) });
    expect(check).toEqual([{
      id: "correction:removal-1",
      title: "RM-26-003: Returned by Isometric",
      detail: `${phrase} You can correct this batch's records, and its emissions entries on the Emissions tab.`,
      target: { tab: "emissions" },
    }]);
  });

  it("keeps absent sources empty", () => {
    expect(buildCreditBatchOpenItems(batchContext)).toEqual({
      blocking: [],
      check: [],
    });
  });

  it("names the problem for unmet checks and routes local fixes and external records", () => {
    const result = buildCreditBatchOpenItems({ ...batchContext,
      health: {
        state: "incomplete",
        issueCount: 4,
        checks: [
          {
            key: "carbon",
            label: "Carbon",
            requirementLabel: "Sample data complete",
            unmetLabel: "No Sample data",
            status: "unmet",
          },
          {
            key: "emissions",
            label: "Emissions",
            requirementLabel: "Emissions recorded",
            unmetLabel: "Emissions not recorded",
            status: "unmet",
          },
          {
            key: "templateSet",
            label: "Template",
            requirementLabel: "Template resolved",
            unmetLabel: "Template components not ready",
            status: "unmet",
          },
          {
            key: "transport",
            label: "Transport",
            requirementLabel: "Distances recorded",
            unmetLabel: "Distances not recorded",
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
            unmetLabel: "No production linked",
            status: "met",
          },
        ],
      },
    });
    expect(result.blocking.map(row => [row.title, row.target])).toEqual([
      ["No Sample data", { tab: "samples" }],
      ["Emissions not recorded", { tab: "emissions" }],
      ["Template components not ready", { href: "/settings/removal-templates?facility=facility" }],
      ["Distances not recorded", { href: "/customers?location=location" }],
    ]);
  });

  it("lists Sample document warnings as Check items on the Samples tab", () => {
    const documentWarnings = sampleDocumentWarningKeys({
      sampling: "sampled", creditBatchCode: "CB-1", hasLabReport: false,
      hasReflectanceHistogram: false, durabilityOption: "1000_year",
    });
    const result = buildCreditBatchOpenItems({ ...batchContext,
      health: { state: "ready", issueCount: 0, checks: [], documentWarnings: [...documentWarnings, "labReport"] } });
    expect(result.blocking).toEqual([]);
    expect(result.check.map(item => [item.id, item.title, item.target])).toEqual([
      ["document:lab-report", "No lab report on any Sample", { tab: "samples" }],
      ["document:reflectance-histogram", "No reflectance histogram on any Sample", { tab: "samples" }],
    ]);
  });

  it("keeps a requirement's reasoning for its ⓘ", () => {
    const result = buildCreditBatchOpenItems({ ...batchContext, health: { state: "incomplete", issueCount: 1, checks: [{
      key: "production", label: "Production", requirementLabel: "Linked production data", unmetLabel: "No production run linked", status: "unmet",
      whyDetail: "Every applied tonne traces to a production run.",
    }] } });
    expect(result.blocking[0].why).toBe("Every applied tonne traces to a production run.");
  });

  it.each<BatchHealthFixTarget>([
    "templateSetup", "batchDetails", "labSamples", "emissions",
    "templateLineReview", "templateLines", "certificationTemplates", "certificationEmissions", "productionRuns",
  ])("preserves the repair destination for %s", fixTarget => {
    const check = { key: "templateSet" as const, label: "Template", requirementLabel: "Template ready", unmetLabel: "Template not ready",
      status: "unmet" as const, fixTarget };
    const localTargets = {
      batchDetails: { tab: "overview", rowId: CREDIT_BATCH_DETAILS_ROW },
      labSamples: { tab: "samples" },
      emissions: { tab: "emissions" },
    };
    const local = localTargets[fixTarget as keyof typeof localTargets];
    const result = buildCreditBatchOpenItems({ ...batchContext,
      health: { state: "incomplete", issueCount: 1, checks: [check] } });
    expect(result.blocking[0].target).toEqual(local ?? {
      href: batchHealthFixLinkFor(check, "facility", "batch").href,
    });
  });

  it.each<BatchHealthFixTarget>([
    "templateLineReview", "templateLines", "certificationTemplates", "certificationEmissions", "emissions",
  ])("routes emission review to %s", fixTarget => {
    const result = buildCreditBatchOpenItems({ ...batchContext, emissionLines: [{
      componentId: "diesel", displayName: "Diesel", state: "needsReview", groupKey: "production", groupName: "Production", groupPosition: 0, position: 0,
      description: null, entryPolicy: "additive", records: null,
      blueprintKey: "production", contract: undefined, automaticFigure: null, entries: [], total: null,
      blocker: { code: "lineNeedsReview", message: "Review this line", fixTarget },
    }] });
    expect(result.check[0].target).toEqual(fixTarget === "emissions"
      ? { tab: "emissions", rowId: "diesel" }
      : { href: batchHealthFixLinkFor({ key: "emissions", fixTarget }, "facility", "batch").href });
  });

  it("gives a member no Answer in Settings link, only who decides the components", () => {
    const check = { key: "templateLines" as const, label: "Components decided", requirementLabel: "Components decided", unmetLabel: "5 components to decide",
      status: "unmet" as const, fixTarget: "templateLineReview" as const, linesToDecide: 5, detail: "Answer them in Settings, Removal templates." };
    const line = {
      componentId: "diesel", displayName: "Diesel", state: "needsReview" as const, groupKey: "production", groupName: "Production", groupPosition: 0, position: 0,
      description: null, entryPolicy: "additive" as const, records: null,
      blueprintKey: "production", contract: undefined, automaticFigure: null, entries: [], total: null,
      blocker: { code: "lineNeedsReview" as const, message: "Decide it in Removal templates.", fixTarget: "templateLineReview" as const },
    };
    const input = { ...batchContext, health: { state: "incomplete" as const, issueCount: 1, checks: [check] }, emissionLines: [line] };

    const member = buildCreditBatchOpenItems({ ...input, canManage: false });
    expect(member.blocking[0]).toMatchObject({
      title: "5 components to decide", detail: "An Admin answers them in Settings, Removal templates.", target: null,
    });
    expect(member.check[0]).toMatchObject({ detail: "An Admin answers it in Settings, Removal templates.", target: null });

    const owner = buildCreditBatchOpenItems({ ...input, canManage: true });
    expect(owner.blocking[0]).toMatchObject({ detail: "Answer them in Settings, Removal templates." });
    expect(owner.blocking[0].target).toEqual({ href: batchHealthFixLinkFor(check, "facility", "batch").href });
    expect(owner.check[0].target).toEqual({ href: batchHealthFixLinkFor({ key: "emissions", fixTarget: "templateLineReview" }, "facility", "batch").href });
  });

  it.each([false, true])("keeps the Removal templates link on a template component problem when canManage is %s", canManage => {
    const check = { key: "templateLines" as const, label: "Components decided", requirementLabel: "Components decided", unmetLabel: "Template not fully read",
      status: "unmet" as const, fixTarget: "templateLines" as const, detail: "Some inputs could not be read from Isometric." };
    const line = {
      componentId: "diesel", displayName: "Diesel", state: "needsReview" as const, groupKey: "production", groupName: "Production", groupPosition: 0, position: 0,
      description: null, entryPolicy: "additive" as const, records: null,
      blueprintKey: "production", contract: undefined, automaticFigure: null, entries: [], total: null,
      blocker: { code: "lineNeedsReview" as const, message: "Some inputs could not be read from Isometric.", fixTarget: "templateLines" as const },
    };
    const result = buildCreditBatchOpenItems({ ...batchContext, canManage,
      health: { state: "incomplete", issueCount: 1, checks: [check] }, emissionLines: [line] });
    expect(result.blocking[0]).toMatchObject({
      title: "Template not fully read", detail: check.detail,
      target: { href: batchHealthFixLinkFor(check, "facility", "batch").href },
    });
    expect(result.check[0]).toMatchObject({
      detail: line.blocker.message,
      target: { href: batchHealthFixLinkFor({ key: "emissions", fixTarget: "templateLines" }, "facility", "batch").href },
    });
    expect(batchHealthFixLinkFor(check, "facility", "batch").label).toBe("Open Removal templates");
  });

  it("groups threshold, pairing, and emission review items", () => {
    const input = {
      ...fixture(),
      emissionLines: [{
        componentId: "diesel",
        displayName: "Diesel",
        state: "needsReview" as const,
        groupKey: "production",
        groupName: "Production",
        groupPosition: 0,
        position: 0,
        description: null,
        entryPolicy: "additive" as const,
        records: null,
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
});

it("surfaces a negative O/C_org as an unpaired H/C sample", () => {
  const [durability] = buildDurabilityBatchSummaries([{
    creditBatchId: "batch", creditBatchCode: "CB-1", sampling: "sampled", runs: [],
    samples: [{ id: "sample", sampleCode: "SAM-1", hToCOrgRatio: 0.3, oToCOrgRatio: -0.1 } as Sample],
  }]);
  expect(durability.replicates[0]).toMatchObject({ hToCorg: 0.3, oToCorg: null });
  expect(buildCreditBatchOpenItems({ ...batchContext, durability }).check).toEqual([{
    id: "unpaired:SAM-1", title: "Sample SAM-1 has H/C without paired O/C",
    target: { tab: "samples", rowId: "sample" },
  }]);

});

describe("entries recorded after the Removal was sent", () => {
  const line = (carry: unknown, extra: object = {}) => ({
    componentId: "diesel", displayName: "Diesel use", state: "filled", groupKey: "production", groupName: "Production", groupPosition: 0, position: 0,
    description: null, entryPolicy: "additive", records: null, blueprintKey: "production", contract: undefined, automaticFigure: null, total: null,
    entries: [{ id: "e1", componentId: "diesel", kind: "value", occurredOn: "2026-09-14", hasEvidence: true, total: null, counts: true,
      recordedAfter: { removalId: "rm-9", removalCode: "RM-26-009" }, carry, ...extra }],
  }) as never;
  const waiting = (waitingReason: string) => ({ receiver: null, waitingReason });

  it.each([
    ["noDraft", "No later draft is available at this facility.", "/certification/removals?facility=facility&create=true"],
    ["incompatibleTemplate", "The next draft's template cannot take this component.", "/settings/removal-templates?facility=facility"],
    ["templateUnknown", "noma has not read the next draft's template yet. Open the Removal to load it.", "/certification/removals?facility=facility"],
  ])("blocks on a waiting entry: %s", (reason, text, href) => {
    const { blocking } = buildCreditBatchOpenItems({ ...batchContext, emissionLines: [line(waiting(reason))] });
    expect(blocking).toEqual([{
      id: "late-entry:e1",
      title: "Diesel use of Sep 14, 2026 is waiting for a Removal",
      detail: `Recorded after RM-26-009 was sent. ${text}`,
      target: { href },
    }]);
  });

  it("is not open once a Removal has it or reported it", () => {
    const receiver = { removalId: "rm-10", removalCode: "RM-26-010", creditBatchCodes: ["CB-26-010"], creditBatchIds: ["cb-10"], anotherCreditBatch: true };
    expect(buildCreditBatchOpenItems({ ...batchContext, emissionLines: [line({ receiver, waitingReason: null })] }).blocking).toEqual([]);
    expect(buildCreditBatchOpenItems({ ...batchContext, emissionLines: [line({ receiver: null, waitingReason: null }, { reportedIn: receiver })] }).blocking).toEqual([]);
  });

  it("ignores a waiting entry that was not recorded after its Removal was sent", () => {
    expect(buildCreditBatchOpenItems({ ...batchContext, emissionLines: [line(waiting("noDraft"), { recordedAfter: null })] }).blocking).toEqual([]);
  });
});
