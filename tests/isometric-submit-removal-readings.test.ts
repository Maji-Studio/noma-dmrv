import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  REMOVAL_ID,
  USER_ID,
  fakeExternalIds,
  isometricClientFake,
  makeContext,
  storedRows,
} from "./fixtures/submit-removal-orchestrator";
import { makeTestOrgContext } from "./helpers/test-org";
import * as readings from "@/data-access/production-run-readings";
import * as runReadings from "@/data-access/production-runs/readings";
import * as imports from "@/data-access/production-run-reading-imports";
import * as csv from "@/lib/production-readings/readings-csv";
import * as measurementSamples from "@/lib/isometric/measurement-samples";
import * as isometric from "@/lib/isometric";
import * as sourceVerification from "@/lib/isometric/source-binding-verification";
import * as certifyContext from "@/fn/certification/certify-context-core";
import { buildEntityReadinessResult } from "@/fn/certification/certify-readiness-gaps";
import { compileRemovalSubmission } from "@/fn/certification/removal-submission-build";
import { prepareRemovalSubmission } from "@/fn/certification/removal-submission-prepare";
import { submitRemoval } from "@/fn/certification/submit-removal";
import { deriveRemovalReadiness } from "@/lib/certification/readiness";
import { toRemovalReadinessFacts } from "@/lib/certification/readiness-facts";

vi.mock("@/data-access/production-run-readings");
vi.mock("@/data-access/production-runs/readings");
vi.mock("@/data-access/production-run-reading-imports");
vi.mock("@/lib/production-readings/readings-csv");
vi.mock("@/lib/isometric/source-binding-verification", () => ({
  verifyRemovalSourceBindings: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(sourceVerification.verifyRemovalSourceBindings).mockResolvedValue({
    state: "verified", verifiedCount: 1, totalCount: 1, mismatches: [],
  });
  for (const fn of [...Object.values(readings), ...Object.values(runReadings), ...Object.values(imports), ...Object.values(csv)]) {
    vi.mocked(fn).mockImplementation(() => {
      throw new Error("Removal submission must not read or parse structured telemetry");
    });
  }
  // #987 removed Sensors/Parquet upload modules. Any restored upload path must
  // still stay outside Removal compilation and submission, including swallowed failures.
  for (const fn of Object.values(isometricClientFake)) {
    fn.mockImplementation(() => {
      throw new Error("Unexpected registry telemetry request");
    });
  }
});

function contextWithReadingsFile(hasReadingsFile: boolean) {
  const ctx = makeContext();
  ctx.runs = ctx.runs.map((run) => ({
    ...run,
    status: "complete",
    hasReadingsFile,
    feedstockWetMassKg: 5_000,
    feedstockMoisturePercent: 20,
    biocharOutputKg: 1_500,
    biocharMoisturePercent: 10,
  }));
  ctx.entityReadinessGaps = buildEntityReadinessResult(
    ctx.runs, ctx.batchesWithSamples, ctx.transportLegs, ctx.requiredTransportCategories,
  ).gaps;
  return ctx;
}

describe("Removal pressure-file evidence boundary (#627)", () => {
  it("compiles and submits with a retained file and no telemetry calls", async () => {
    const ctx = contextWithReadingsFile(true);
    expect(ctx.entityReadinessGaps).toEqual([]);
    expect(deriveRemovalReadiness(toRemovalReadinessFacts(ctx)).state).toBe("ready");
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(ctx);
    const measurement = vi.spyOn(measurementSamples, "createMeasurementSample");
    const signedUpload = vi.spyOn(isometric, "requestSignedUploadUrl");
    const prepared = prepareRemovalSubmission(ctx);
    expect(prepared.blockers).toEqual([]);
    const compiled = await compileRemovalSubmission({
      orgCtx: makeTestOrgContext(USER_ID), removalId: REMOVAL_ID,
      ctx, prepared: prepared.prepared!,
    });
    expect(compiled.blockers).toEqual([]);
    expect(compiled.snapshot).not.toBeNull();

    vi.mocked(isometric.createDatapoint).mockImplementation(fakeExternalIds("dtp") as never);
    vi.mocked(isometric.createGhgEntry).mockImplementation(fakeExternalIds("rem") as never);
    await expect(submitRemoval({
      orgCtx: makeTestOrgContext(USER_ID), removalId: REMOVAL_ID,
    })).resolves.toMatchObject({ externalId: "rem_1" });
    expect(storedRows[0].status).toBe("submitted");
    expect(isometric.createGhgEntry).toHaveBeenCalledOnce();
    for (const fn of [...Object.values(readings), ...Object.values(runReadings), ...Object.values(imports), ...Object.values(csv)]) {
      expect(fn).not.toHaveBeenCalled();
    }
    for (const fn of Object.values(isometricClientFake)) {
      expect(fn).not.toHaveBeenCalled();
    }
    expect(measurement).not.toHaveBeenCalled();
    expect(signedUpload).not.toHaveBeenCalled();
  });

  it("blocks readiness, compilation and submission when the retained file is absent", async () => {
    const ctx = contextWithReadingsFile(false);
    expect(ctx.entityReadinessGaps).toEqual(["Production run PR-TEST-001: Readings CSV file"]);
    expect(deriveRemovalReadiness(toRemovalReadinessFacts(ctx)).state).toBe("blocked");
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(ctx);
    const prepared = prepareRemovalSubmission(ctx);
    const compiled = await compileRemovalSubmission({
      orgCtx: makeTestOrgContext(USER_ID), removalId: REMOVAL_ID,
      ctx, prepared: prepared.prepared!,
    });
    expect(compiled.blockers.join("\n")).toContain("Readings CSV file");
    expect(compiled.snapshot).toBeNull();
    await expect(submitRemoval({
      orgCtx: makeTestOrgContext(USER_ID), removalId: REMOVAL_ID,
    })).rejects.toThrow("Readings CSV file");
    expect(isometric.createGhgEntry).not.toHaveBeenCalled();
    expect(isometric.createDatapoint).not.toHaveBeenCalled();
    expect(storedRows).toEqual([]);
  });
});
