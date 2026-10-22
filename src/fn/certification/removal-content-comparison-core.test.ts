import { beforeEach, expect, it, vi } from "vitest";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";
import { getSentRemovalForComparison, loadRemovalCorrectionFacts, listStatementRemovalIdentities } from "@/data-access/removal-entry-correction";
import { getCreditBatchesByRemovalId } from "@/data-access/certifier-removals";
import { getTemplateObservationById, getLatestTemplateObservation } from "@/data-access/removal-template-observations";
import { loadRemovalEntryCorrection } from "./removal-correction-core";
import { compileRemovalCorrectionContent } from "./removal-correction-compile-core";
import { assertStatementRemovalsCurrent } from "./statement-removal-correction-core";
import { compareRemovalCurrentContent } from "./removal-content-comparison-core";
import { z } from "zod";
import { logger } from "@/lib/log";
import { loadBatchEmissionEntryFacts } from "@/data-access/emission-entry-facts";
import { RemovalComparisonBlockedError } from "./removal-comparison-blocked-error";
import { SafeError } from "@/lib/errors";

vi.mock("@/data-access/removal-entry-correction", () => ({ getSentRemovalForComparison: vi.fn(), loadRemovalCorrectionFacts: vi.fn(), listStatementRemovalIdentities: vi.fn() }));
vi.mock("@/data-access/certifier-removals", () => ({ getCreditBatchesByRemovalId: vi.fn() }));
vi.mock("@/data-access/removal-template-observations", () => ({ getTemplateObservationById: vi.fn(), getLatestTemplateObservation: vi.fn() }));
vi.mock("@/data-access/emission-entry-facts", () => ({ loadBatchEmissionEntryFacts: vi.fn(async () => ({ previousObservations: new Map() })) }));
vi.mock("./removal-correction-compile-core", () => ({ compileRemovalCorrectionContent: vi.fn() }));
vi.mock("@/lib/log", () => ({ logger: { warn: vi.fn() } }));
const ctx = makeTestOrgContext();
const observation = { id: "sent-observation", definition: { groups: [{ components: [{ id: "energy", displayName: "Energy" }] }] } };
const semantic = { sourceIds: ["sent-file"], entryContributions: [] };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSentRemovalForComparison).mockResolvedValue({ payloadSnapshot: { templateObservationId: observation.id, semantic } } as never);
  vi.mocked(getCreditBatchesByRemovalId).mockResolvedValue([{ id: "batch", code: "CB-1", removalTemplateId: "template" }] as never);
  vi.mocked(getTemplateObservationById).mockResolvedValue(observation as never);
  vi.mocked(compileRemovalCorrectionContent).mockResolvedValue(semantic);
  vi.mocked(listStatementRemovalIdentities).mockResolvedValue([{ id: "removal", code: "R-12" }]);
  vi.mocked(loadRemovalCorrectionFacts).mockResolvedValue({ submitted: { payloadSnapshot: { templateObservationId: observation.id, semantic } },
    batches: [{ id: "batch", code: "CB-1", removalTemplateId: "template" }],
    correction: { returnedStatement: { id: "statement", status: "FAILED_VERIFICATION" } },
    identity: { code: "R-12", reportingPeriodStartOn: "2026-04-01", reportingPeriodEndOn: "2026-06-30" },
  } as never);
});

it.each(["file-only", "entry-only", "compile-refusal", "missing-observation", "unchanged"])("gives both callers the same verdict for %s", async scenario => {
  if (scenario === "file-only") vi.mocked(compileRemovalCorrectionContent).mockResolvedValue({ ...semantic, sourceIds: ["current-file"] });
  if (scenario === "entry-only") vi.mocked(compileRemovalCorrectionContent).mockResolvedValue({ ...semantic,
    entryContributions: [{ componentId: "energy", inputKey: "fuel", entries: [{ entryId: "entry", creditBatchId: "batch",
      contentRevision: 1, kind: "value", value: { magnitude: "12", unit: "L" }, evidenceDocumentIds: [] }] }],
  });
  if (scenario === "compile-refusal") vi.mocked(compileRemovalCorrectionContent).mockRejectedValue(new SafeError("Invalid current content"));
  if (scenario === "missing-observation") vi.mocked(getTemplateObservationById).mockResolvedValue(null);
  const unavailable = scenario === "compile-refusal" || scenario === "missing-observation";
  const unchanged = scenario === "unchanged";
  const comparison = await compareRemovalCurrentContent(ctx, "removal");
  expect(comparison.kind).toBe(unavailable ? "unavailable" : unchanged ? "unchanged" : "changed");
  const notice = await loadRemovalEntryCorrection(ctx, "removal");
  expect(notice.correctionNeeded).toBe(!unchanged);
  expect(notice.correction?.resubmitNeeded).toBe(!unchanged);
  expect(notice.changedComponentIds).toEqual(comparison.state.changedComponentIds);
  expect(notice.comparison).toBe(comparison.kind);
  if (unavailable) {
    expect(notice.message).toBe("Resubmit needed: noma could not compare this Removal with what it sent.");
    expect(notice.unavailableMessages).toEqual([]);
    expect(notice.unavailableReason).toBe(scenario === "compile-refusal" ? "compile_refused" : "missing_observation");
  }
  if (scenario === "entry-only") {
    expect(notice.correction?.changed).toEqual([{ componentId: "energy", componentName: "Energy", batchId: "batch", batchCode: "CB-1" }]);
  }
  const guard = assertStatementRemovalsCurrent(ctx, "statement");
  if (unchanged) await expect(guard).resolves.toBeUndefined();
  else await expect(guard).rejects.toThrow(unavailable ? "noma could not compare Removal R-12" : "Resubmit Removal R-12 first");
  if (scenario !== "missing-observation") expect(compileRemovalCorrectionContent).toHaveBeenCalledWith(ctx, "removal", observation, true);
  expect(getLatestTemplateObservation).not.toHaveBeenCalled();
});

it("uses the pin only for legacy snapshots without an observation id", async () => {
  vi.mocked(getSentRemovalForComparison).mockResolvedValue({ payloadSnapshot: { semantic } } as never);
  vi.mocked(getLatestTemplateObservation).mockResolvedValue(observation as never);
  expect(await compareRemovalCurrentContent(ctx, "removal")).toMatchObject({ kind: "unchanged" });
  expect(getTemplateObservationById).not.toHaveBeenCalled();
  expect(getLatestTemplateObservation).toHaveBeenCalledWith(ctx, "isometric", "template");
});

it("reuses the notice facts and hydrates historical names only for its changed pairs", async () => {
  vi.mocked(compileRemovalCorrectionContent).mockResolvedValue({ ...semantic, inputs: [{ rtcId: "historical", value: 12 }] });
  vi.mocked(loadBatchEmissionEntryFacts).mockResolvedValue({ previousObservations: new Map([
    ["old", { definition: { groups: [{ components: [{ id: "historical", displayName: "Historical name" }] }] } }],
  ]) } as never);
  const notice = await loadRemovalEntryCorrection(ctx, "removal");
  expect(getSentRemovalForComparison).not.toHaveBeenCalled();
  expect(getCreditBatchesByRemovalId).not.toHaveBeenCalled();
  expect(loadBatchEmissionEntryFacts).toHaveBeenCalledExactlyOnceWith(ctx, "batch", observation);
  expect(notice.correction?.changed).toEqual([{ componentId: "historical", componentName: "Historical name", batchId: "batch", batchCode: "CB-1" }]);
  vi.mocked(loadBatchEmissionEntryFacts).mockClear();
  vi.mocked(loadBatchEmissionEntryFacts).mockRejectedValue(new SafeError("Presentation unavailable"));
  await expect(assertStatementRemovalsCurrent(ctx, "statement")).rejects.toThrow("Resubmit Removal R-12 first");
  expect(loadBatchEmissionEntryFacts).not.toHaveBeenCalled();
});

it("carries compile blocker messages and reason through both notice projections and fails closed", async () => {
  const messages = ["Add a file for each emissions entry with a value.", "Review this component's entry policy. Paired inputs require a single entry."];
  vi.mocked(compileRemovalCorrectionContent).mockRejectedValue(new RemovalComparisonBlockedError(messages));
  expect(await compareRemovalCurrentContent(ctx, "removal")).toMatchObject({
    kind: "unavailable", reason: "compile_refused", unavailableMessages: messages,
  });
  const notice = await loadRemovalEntryCorrection(ctx, "removal");
  expect(notice).toMatchObject({ comparison: "unavailable", unavailableReason: "compile_refused", unavailableMessages: messages,
    correctionNeeded: true, message: "Resubmit needed: noma could not compare this Removal with what it sent.",
    correction: { comparison: "unavailable", unavailableReason: "compile_refused", unavailableMessages: messages, resubmitNeeded: true, changed: [] },
  });
  await expect(assertStatementRemovalsCurrent(ctx, "statement")).rejects.toThrow("noma could not compare Removal R-12");
});

it.each(["invalid_snapshot", "invalid_compile"] as const)("logs notice %s with only id and reason", async reason => {
  if (reason === "invalid_snapshot") {
    const loaded = await loadRemovalCorrectionFacts(ctx, "removal");
    vi.mocked(loadRemovalCorrectionFacts).mockResolvedValue({ ...loaded, submitted: { payloadSnapshot: { semantic: "private body" } } } as never);
  } else {
    const parsed = z.string().safeParse({ privateBody: "sensitive" });
    if (parsed.success) throw new Error("Expected invalid test fixture");
    vi.mocked(compileRemovalCorrectionContent).mockRejectedValue(parsed.error);
  }
  expect(await loadRemovalEntryCorrection(ctx, "removal")).toMatchObject({
    comparison: "unavailable", unavailableReason: reason, unavailableMessages: [], correctionNeeded: true,
  });
  expect(logger.warn).toHaveBeenCalledExactlyOnceWith({ removalId: "removal", reason }, "Removal notice comparison failed");
});
