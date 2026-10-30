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
  buildCreditBatchOpenItems as buildItems,
  CREDIT_BATCH_DETAILS_ROW,
  heldMissingRuns,
  missingRunsCountedSentence,
  missingRunsMemberNamedSentence,
  missingRunsMemberSentence,
  sameDayEntryWarning,
  missingRunsAdminSentence,
  refusedRunsSentence,
  sameDayEntrySentence,
  openItemText,
} from "./open-items";

import { overviewBadgeCount, readOnlyOpenItems, tabBadge } from "./batch-page";
import { renderedOpenItems } from "../../../tests/helpers/rendered-open-items";

const buildCreditBatchOpenItems: typeof buildItems = (input) => renderedOpenItems(buildItems(input));

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
      target: { href: "/removals?facility=facility&removal=removal-1" },
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

describe("missing production runs", () => {
  const run = { id: "run", code: "RUN-112", startDate: "2026-09-09", createdAt: new Date("2026-10-01"), heldByRemovalCode: null };
  const missingProductionRuns = { sentRemovalCodes: [], heldRemovalCodes: ["RM-009"],
    batchStartDate: "2026-09-01", runs: [run], manualEntries: [] };

  it.each([
    { heldRemovalCodes: ["RM-009"], holders: "RM-009" },
    { heldRemovalCodes: ["RM-009", "RM-010"], holders: "RM-009 and RM-010" },
  ])("names the unsent holders $holders and opens Edit", ({ heldRemovalCodes, holders }) => {
    const items = buildCreditBatchOpenItems({ ...batchContext,
      missingProductionRuns: { ...missingProductionRuns, heldRemovalCodes } });
    expect(items).toEqual({ blocking: [], check: [{
      id: "missing-production-run:run",
      productionRun: { id: "run", code: "RUN-112" },
      title: "RUN-112 is not in this credit batch yet",
      titleAfterCode: " is not in this credit batch yet",
      detail: `Its emissions are not counted in ${holders}.`,
      target: { tab: "overview", rowId: CREDIT_BATCH_DETAILS_ROW },
    }] });
    expect(overviewBadgeCount({ ...items, waiting: [] })).toBe(1);
    expect(tabBadge("overview", { ...items, waiting: [] })).toEqual({ count: 1, blocking: false });
  });

  it("drops \"yet\" from the title on a read-only batch", () => {
    const [item] = readOnlyOpenItems({ ...buildItems({ ...batchContext, missingProductionRuns }), waiting: [] }).check;
    expect(item.title).toBe("RUN-112 is not in this credit batch");
    expect(item.titleAfterCode).toBe(" is not in this credit batch");
  });

  it("asks an admin to add the run when the viewer cannot manage", () => {
    expect(buildCreditBatchOpenItems({ ...batchContext, canManage: false, missingProductionRuns }))
      .toEqual({ blocking: [], check: [{
        id: "missing-production-run:run",
        productionRun: { id: "run", code: "RUN-112" },
        title: "RUN-112 is not in this credit batch yet",
        titleAfterCode: " is not in this credit batch yet",
        detail: "Its emissions are not counted in RM-009. An admin can add it in Edit.",
        target: null,
      }] });
  });

  it.each([
    { occurredOn: "2026-09-10", createdAt: new Date("2026-10-02"), sameDayEntry: false },
    { occurredOn: run.startDate, createdAt: new Date("2026-09-30"), sameDayEntry: false },
    { occurredOn: run.startDate, createdAt: run.createdAt, sameDayEntry: false },
    { occurredOn: run.startDate, createdAt: new Date("2026-10-02"), sameDayEntry: true },
  ])("keeps held runs visible and flags a later same-day entry ($occurredOn, $createdAt)", ({ occurredOn, createdAt, sameDayEntry }) => {
    const { blocking, check } = buildCreditBatchOpenItems({ ...batchContext, missingProductionRuns: {
      ...missingProductionRuns, runs: [run, { ...run, id: "second", code: "RUN-113" }],
      manualEntries: [{ occurredOn, createdAt }],
    } });
    expect(blocking).toEqual([]);
    expect(check.map(item => item.id)).toEqual(["missing-production-run:run", "missing-production-run:second"]);
    expect(check.map(item => item.detail)).toEqual(Array(2).fill(sameDayEntry
      ? "Its emissions are not counted in RM-009. If the Emissions entry dated Sep 9, 2026 already records them, delete it when you add the run."
      : "Its emissions are not counted in RM-009."));
  });

  it("flags the missing-run Check with a structured same-day marker", () => {
    const { check } = buildCreditBatchOpenItems({ ...batchContext, missingProductionRuns: {
      ...missingProductionRuns, runs: [run],
      manualEntries: [{ occurredOn: run.startDate, createdAt: new Date("2026-10-02") }],
    } });
    expect(check[0].sameDayEntryDate).toBe(run.startDate);
    const none = buildCreditBatchOpenItems({ ...batchContext, missingProductionRuns }).check;
    expect(none[0].sameDayEntryDate).toBeUndefined();
  });

  it("uses the batch start day for the same-day warning on an early held run", () => {
    const early = { ...run, startDate: "2026-08-31" };
    const entry = { occurredOn: missingProductionRuns.batchStartDate, createdAt: new Date("2026-10-02") };
    expect(buildCreditBatchOpenItems({ ...batchContext, missingProductionRuns: {
      ...missingProductionRuns, runs: [early], manualEntries: [entry],
    } }).check).toEqual([{
      id: "missing-production-run:run", productionRun: { id: run.id, code: run.code },
      title: "RUN-112 is not in this credit batch yet", titleAfterCode: " is not in this credit batch yet", sameDayEntryDate: "2026-09-01",
      detail: "Its emissions are not counted in RM-009. If the Emissions entry dated Sep 1, 2026 already records them, delete it when you add the run.",
      target: { tab: "overview", rowId: CREDIT_BATCH_DETAILS_ROW },
    }]);
    const otherDayItems = buildCreditBatchOpenItems({ ...batchContext, missingProductionRuns: {
      ...missingProductionRuns, runs: [early], manualEntries: [{ ...entry, occurredOn: early.startDate }],
    } }).check;
    expect(otherDayItems.map(item => item.id)).toEqual(["missing-production-run:run"]);
    expect(otherDayItems[0].detail).toBe("Its emissions are not counted in RM-009.");
  });

  it.each([true, false])("opens Emissions for a held allocation for any role (canManage %s)", canManage => {
    const missing = { ...missingProductionRuns, runs: [{ ...run, heldByRemovalCode: "RM-010" }] };
    const items = buildCreditBatchOpenItems({ ...batchContext, canManage, missingProductionRuns: missing });
    expect(items).toEqual({ blocking: [], check: [{
      id: "late-production-run:run", productionRun: { id: run.id, code: run.code },
      title: "RUN-112 cannot be added to this credit batch", titleAfterCode: " cannot be added to this credit batch",
      detail: "Its biochar is in an Application that RM-010 already holds. Record its diesel and power on the Emissions tab, dated Sep 9, 2026.",
      target: { tab: "emissions" },
    }] });
    expect(heldMissingRuns(missing)).toEqual([{
      id: run.id, code: run.code, entryDate: run.startDate, heldByRemovalCode: "RM-010", sameDayEntry: false,
    }]);
  });

  it.each([true, false])("clears only refused runs after a later same-day entry (canManage %s)", canManage => {
    const missing = { ...missingProductionRuns,
      runs: [{ ...run, heldByRemovalCode: "RM-010" }, { ...run, id: "addable", code: "RUN-113" }],
      manualEntries: [{ occurredOn: run.startDate, createdAt: new Date("2026-10-02") }],
    };
    const refusedOnly = { ...missing, runs: [missing.runs[0]] };
    expect(heldMissingRuns(refusedOnly)).toEqual([]);
    expect(buildCreditBatchOpenItems({ ...batchContext, canManage, missingProductionRuns: refusedOnly }))
      .toEqual({ blocking: [], check: [] });
    expect(heldMissingRuns(missing)).toEqual([{
      id: "addable", code: "RUN-113", entryDate: run.startDate, heldByRemovalCode: null, sameDayEntry: true,
    }]);
    const { blocking, check } = buildCreditBatchOpenItems({ ...batchContext, canManage, missingProductionRuns: missing });
    expect(blocking).toEqual([]);
    expect(check.map(item => item.id)).toEqual(["missing-production-run:addable"]);
    expect(check[0].sameDayEntryDate).toBe(run.startDate);
  });

  it("keeps the member's add guidance even when a same-day entry exists", () => {
    expect(buildCreditBatchOpenItems({ ...batchContext, canManage: false, missingProductionRuns: {
      ...missingProductionRuns, manualEntries: [{ occurredOn: run.startDate, createdAt: new Date("2026-10-02") }],
    } }).check[0]).toEqual({
      id: "missing-production-run:run", productionRun: { id: run.id, code: run.code },
      title: "RUN-112 is not in this credit batch yet", titleAfterCode: " is not in this credit batch yet", sameDayEntryDate: "2026-09-09",
      detail: "Its emissions are not counted in RM-009. An admin can add it in Edit.", target: null,
    });
  });

  it("projects every fitting held run and excludes Sent and unheld batches", () => {
    expect(heldMissingRuns(missingProductionRuns)).toEqual([{
      id: run.id, code: run.code, entryDate: run.startDate, heldByRemovalCode: null, sameDayEntry: false,
    }]);
    expect(heldMissingRuns({ ...missingProductionRuns, sentRemovalCodes: ["RM-008"] })).toEqual([]);
    expect(heldMissingRuns({ ...missingProductionRuns, heldRemovalCodes: [] })).toEqual([]);
  });

  it("omits unheld unsent batches whose membership expands automatically", () => {
    expect(buildCreditBatchOpenItems({ ...batchContext,
      missingProductionRuns: { ...missingProductionRuns, heldRemovalCodes: [] } }))
      .toEqual({ blocking: [], check: [] });
  });

  it.each([true, false])("keeps Sent copy and its Emissions target unchanged (canManage %s)", canManage => {
    expect(buildCreditBatchOpenItems({ ...batchContext, canManage, missingProductionRuns: {
      ...missingProductionRuns, sentRemovalCodes: ["RM-008"],
    } })).toEqual({ blocking: [], check: [{
      id: "late-production-run:run",
      productionRun: { id: "run", code: "RUN-112" },
      title: "RUN-112 was recorded after RM-008 was sent",
      titleAfterCode: " was recorded after RM-008 was sent",
      detail: "It is not in this credit batch. Record its diesel and power on the Emissions tab, dated Sep 9, 2026.",
      target: { tab: "emissions" },
    }] });
  });
});

describe("entries recorded after the Removal was sent", () => {
  const line = (carry: unknown, extra: object = {}) => ({
    componentId: "diesel", displayName: "Diesel use", state: "filled", groupKey: "production", groupName: "Production", groupPosition: 0, position: 0,
    description: null, entryPolicy: "additive", records: null, blueprintKey: "production", contract: undefined, automaticFigure: null, total: null,
    entries: [{ id: "e1", componentId: "diesel", kind: "value", occurredOn: "2026-09-14", hasEvidence: true, total: null, counts: true,
      recordedAfter: { removalId: "rm-9", removalCode: "RM-26-009" }, carry, ...extra }],
  }) as never;
  const waiting = (waitingReason: string) => ({ receiver: null, waitingReason, waitingFor: { removalId: "rm-11", removalCode: "RM-26-011" } });

  it.each([
    ["noDraft", "No later draft is available at this facility.", "/removals?facility=facility&create=true"],
    ["incompatibleTemplate", "The next draft's template cannot take this component.", "/settings/removal-templates?facility=facility"],
    ["templateUnknown", "noma has not read the next draft's template yet. Open the Removal to load it.", "/removals?facility=facility&removal=rm-11"],
  ])("adds a Check for a waiting entry: %s", (reason, text, href) => {
    const { blocking, check } = buildCreditBatchOpenItems({ ...batchContext, emissionLines: [line(waiting(reason))] });
    expect(blocking).toEqual([]);
    expect(check).toEqual([{
      id: "late-entry:e1",
      title: "Diesel use of Sep 14, 2026 is waiting for a Removal",
      detail: `Recorded after RM-26-009 was sent. ${text}`,
      target: { href },
    }]);
  });

  it("places a waiting entry immediately after late production runs and keeps the list non-blocking", () => {
    const items = buildCreditBatchOpenItems({ ...batchContext, emissionLines: [line(waiting("noDraft"))],
      missingProductionRuns: { sentRemovalCodes: ["RM-009"], heldRemovalCodes: [], batchStartDate: "2026-09-01", manualEntries: [],
        runs: [{ id: "run", code: "PR-112", startDate: "2026-09-09", createdAt: new Date("2026-10-01"), heldByRemovalCode: null }] } });
    expect(items.blocking).toEqual([]);
    expect(items.check.map(item => item.id)).toEqual(["late-production-run:run", "late-entry:e1"]);
    expect(overviewBadgeCount({ ...items, waiting: [] })).toBe(2);
    expect(tabBadge("overview", { ...items, waiting: [] })).toEqual({ count: 2, blocking: false });
  });

  it("has no to-do when an entry goes into its own Removal revision", () => {
    expect(buildCreditBatchOpenItems({ ...batchContext, emissionLines: [line(waiting("noDraft"), {
      revisionOf: { removalId: "rm-9", removalCode: "RM-26-009" },
    })] })).toEqual({ blocking: [], check: [] });
  });

  it("is not open once a Removal has it or reported it", () => {
    const receiver = { removalId: "rm-10", removalCode: "RM-26-010", creditBatchCodes: ["CB-26-010"], creditBatchIds: ["cb-10"], anotherCreditBatch: true };
    expect(buildCreditBatchOpenItems({ ...batchContext, emissionLines: [line({ receiver, waitingReason: null })] }).blocking).toEqual([]);
    expect(buildCreditBatchOpenItems({ ...batchContext, emissionLines: [line({ receiver: null, waitingReason: null }, { reportedIn: receiver })] }).blocking).toEqual([]);
  });

  it("adds a Check for a waiting entry that has no earlier sent Removal, without the lead line", () => {
    const { blocking, check } = buildCreditBatchOpenItems({ ...batchContext, emissionLines: [line(waiting("noDraft"), { recordedAfter: null })] });
    expect(blocking).toEqual([]);
    expect(check).toEqual([{
      id: "late-entry:e1",
      title: "Diesel use of Sep 14, 2026 is waiting for a Removal",
      detail: "No later draft is available at this facility.",
      target: { href: "/removals?facility=facility&create=true" },
    }]);
  });

  it("gives a member the template text and no link", () => {
    const { blocking, check } = buildCreditBatchOpenItems({ ...batchContext, canManage: false, emissionLines: [line(waiting("incompatibleTemplate"))] });
    expect(blocking).toEqual([]);
    expect(check[0].detail).toBe("Recorded after RM-26-009 was sent. The next draft's template cannot take this component. An Admin changes it in Settings, Removal templates.");
    expect(check[0].target).toBeNull();
  });
});

it("points an unavailable returned-Removal comparison to the Removal without claiming changed records", () => {
  const { check } = buildCreditBatchOpenItems({ ...batchContext, health: returnedHealth({
    removalId: "removal-1", removalCode: "RM-26-003", windowOpen: true, resubmitNeeded: true,
    comparison: "unavailable", unavailableMessages: ["Add a file for each emissions entry with a value."],
    statement: STATEMENT, batches: [{ id: "batch", code: "CB-1" }], changed: [],
  }) });
  expect(check[0].detail).toBe("noma could not compare RM-26-003 with what it sent. Open the Removal to see why.");
  expect(check[0].title).toBe("RM-26-003: Resubmit needed");
});

describe("missing run copy", () => {
  it.each([
    { codes: ["RUN-112"], sentence: "RUN-112 cannot be added. Record its diesel and power on the credit batch's Emissions tab." },
    { codes: ["RUN-112", "RUN-113"], sentence: "RUN-112 and RUN-113 cannot be added. Record their diesel and power on the credit batch's Emissions tab." },
  ])("names refused runs: $codes", ({ codes, sentence }) => {
    expect(refusedRunsSentence(codes)).toBe(sentence);
  });

  it("says It or They when every run is refused, and names the addable runs for a member", () => {
    expect(refusedRunsSentence(["RUN-112"], true)).toBe("It cannot be added. Record its diesel and power on the credit batch's Emissions tab.");
    expect(refusedRunsSentence(["RUN-112", "RUN-113"], true)).toBe("They cannot be added. Record their diesel and power on the credit batch's Emissions tab.");
    expect(missingRunsMemberNamedSentence(["RUN-1", "RUN-2"])).toBe("An admin can add RUN-1 and RUN-2 in Edit.");
    expect(sameDayEntryWarning([{ code: "RUN-1" }])).toBeNull();
    expect(sameDayEntryWarning([{ code: "RUN-1", sameDayEntryDate: "2026-09-09" }])).toBe(sameDayEntrySentence());
    expect(sameDayEntryWarning([{ code: "RUN-1", sameDayEntryDate: "2026-09-09" }], 2))
      .toBe("If the Emissions entry dated Sep 9, 2026 already records the emissions of RUN-1, delete it when you add the run.");
  });

  it.each([
    { count: 1, counted: "Its emissions are not counted.", member: "An admin can add it in Edit.", admin: "Add it in Edit." },
    { count: 2, counted: "Their emissions are not counted.", member: "An admin can add them in Edit.", admin: "Add them in Edit." },
  ])("uses singular or plural guidance for $count runs", ({ count, counted, member, admin }) => {
    expect(missingRunsCountedSentence(count)).toBe(counted);
    expect(missingRunsMemberSentence(count)).toBe(member);
    expect(missingRunsAdminSentence(count)).toBe(admin);
  });
});


it("removes member-only template repair guidance from read-only checks", () => {
  const health = {
    state: "incomplete" as const, issueCount: 1, checks: [{
      key: "templateLines" as const, label: "Components decided", requirementLabel: "Components decided",
      unmetLabel: "1 component to decide", status: "unmet" as const,
      fixTarget: "templateLineReview" as const, linesToDecide: 1,
    }],
  };
  const groups = buildItems({ ...batchContext, canManage: false, health });
  expect(openItemText(groups.blocking[0])).toBe("An Admin answers it in Settings, Removal templates.");
  const [readOnly] = readOnlyOpenItems({ ...groups, waiting: [] }).blocking;
  expect(readOnly.title).toBe("1 component to decide");
  expect(openItemText(readOnly)).toBeUndefined();
});
