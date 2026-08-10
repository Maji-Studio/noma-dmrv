/**
 * Reporting-window and durability capability tests for `submitRemoval`.
 *
 * Shared orchestrator fixtures and boundary fakes live in
 * `./fixtures/submit-removal-orchestrator`.
 */
import type { IsometricGhgEntryTemplate } from "@/lib/isometric";
import { makeTestOrgContext } from "./helpers/test-org";
import {
  EXTERNAL_FACILITY_ID,
  EXTERNAL_FEEDSTOCK_TYPE_ID,
  EXTERNAL_PRODUCTION_BATCH_ID,
  isometricClientFake,
  ORIGINAL_BIOCHAR_MASS_KG,
  REMOVAL_ID,
  USER_ID,
  fakeExternalIds,
  makeContext,
  makeLineage,
  makeRun,
  make1000YearSequestrationTemplate,
  makeSequestrationTemplate,
  setDurabilityMeasurementSamplesEnabled,
  storedRows,
} from "./fixtures/submit-removal-orchestrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as ledger from "@/data-access/certification";
import * as ledgerClaim from "@/data-access/certification-submissions";
import * as removalsDA from "@/data-access/certifier-removals";
import * as productionBatchesDA from "@/data-access/certifier-production-batches";
import * as certifyContext from "@/fn/certification/certify-context-core";
import * as durabilitySamples from "@/fn/certification/durability-measurement-samples";
import * as evidenceLedgers from "@/fn/certification/ensure-evidence-ledgers";
import * as protocolPreflight from "@/fn/certification/protocol-version-preflight";
import { submitRemoval } from "@/fn/certification/submit-removal";
import * as isometric from "@/lib/isometric";
import * as sourceVerification from "@/lib/isometric/source-binding-verification";

vi.mock("@/fn/certification/protocol-version-preflight", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/fn/certification/protocol-version-preflight")
  >();
  return {
    ...actual,
    checkProtocolVersionAtSubmit: vi.fn(),
  };
});
vi.mock("@/lib/isometric/source-binding-verification", () => ({
  verifyRemovalSourceBindings: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(
    sourceVerification.verifyRemovalSourceBindings,
  ).mockResolvedValue({
    state: "verified",
    verifiedCount: 1,
    totalCount: 1,
    mismatches: [],
  });
});
// ---------------------------------------------------------------------------
// Issue #320 — the reporting window's end anchors on the biochar application
// date (§8.6.2), while durability `measured_at` keeps production-end semantics
// (caveat 1) and a back-dated application fails closed before any POST
// (caveat 4).
// ---------------------------------------------------------------------------

describe("submitRemoval — reporting window anchored to application date (issue #320)", () => {
  // A template carrying BOTH the ordinary mass component and a sequestration
  // component, so one submit exercises the GHG-entry window AND the durability
  // measurement-samples path side by side.
  function makeCombinedTemplate(): IsometricGhgEntryTemplate {
    return make1000YearSequestrationTemplate();
  }

  function prepareDurabilitySubmission(): void {
    setDurabilityMeasurementSamplesEnabled(true);
    const baseContext = makeContext();
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue({
      ...baseContext,
      defaultTemplate: makeCombinedTemplate(),
      durabilityGateBlockers: [],
      batchesWithSamples: baseContext.batchesWithSamples.map((batch) => ({
        ...batch,
        durabilityOption: "1000_year" as const,
        samples: batch.samples.map((sample, index) => ({
          ...sample,
          totalCarbonPercent: 80 + index,
          sReflectanceFraction: 0.9 + index / 100,
        })),
      })),
    });
    vi.mocked(isometric.createDatapoint).mockImplementation(
      fakeExternalIds("dp") as never,
    );
  }

  it("keeps the draft locked when production-batch binding fails after datapoints were created", async () => {
    prepareDurabilitySubmission();
    const originalError = new Error("production batch binding unavailable");
    vi.mocked(
      productionBatchesDA.getProductionBatchRegistryInputs,
    ).mockRejectedValue(originalError);

    await expect(
      submitRemoval({
        orgCtx: makeTestOrgContext(USER_ID),
        removalId: REMOVAL_ID,
      }),
    ).rejects.toBe(originalError);

    expect(storedRows).toHaveLength(1);
    expect(storedRows[0]).toMatchObject({
      status: "draft",
      metadata: {
        lastError: "Removal submission failed unexpectedly. Retry the submission.",
        lastAttemptOutcome: "interrupted",
        externalMutation: "confirmed",
      },
    });
    expect(storedRows[0].lockedAt).not.toBeNull();
    expect(isometric.createDatapoint).toHaveBeenCalled();
    expect(ledger.markSubmissionRejected).not.toHaveBeenCalled();
    expect(ledgerClaim.markSubmissionInterrupted).toHaveBeenCalledOnce();
  });

  it("preserves the submission error when no-mutation rejection cleanup fails", async () => {
    prepareDurabilitySubmission();
    vi.mocked(isometric.createDatapoint).mockRejectedValueOnce(
      new isometric.IsometricApiError(
        "422 Unprocessable",
        422,
        { errors: [{ detail: "invalid datapoint" }] },
        "http",
      ),
    );
    vi.mocked(ledger.markSubmissionRejected).mockRejectedValueOnce(
      new Error("submission ledger unavailable"),
    );

    await expect(
      submitRemoval({
        orgCtx: makeTestOrgContext(USER_ID),
        removalId: REMOVAL_ID,
      }),
    ).rejects.toThrow("Provider rejected the request (422): invalid datapoint");

    expect(ledger.markSubmissionRejected).toHaveBeenCalledOnce();
    expect(storedRows[0]).toMatchObject({ status: "draft" });
    expect(storedRows[0].lockedAt).not.toBeNull();
  });

  it("uses MAX(applicationDate) across lineages for completed_on while durability measured_at keeps the production end", async () => {
    setDurabilityMeasurementSamplesEnabled(true);
    const progress = vi.fn();
    vi.mocked(
      durabilitySamples.submitDurabilityMeasurementSamples,
    ).mockImplementation(async (args) => {
      args.onProgress?.(1, 1);
      expect(progress).toHaveBeenLastCalledWith({
        step: "removal.sending_durability",
        state: "active",
        completed: 1,
        total: 1,
      });
      return {
        submitted: 1,
        samples: [],
        datapointIdsByMeasurementProperty: new Map([
          [
            "mass_fraction_dry_basis|total_carbon",
            ["dtp-carbon-1", "dtp-carbon-2", "dtp-carbon-3"],
          ],
          ["mass", ["dtp-product-mass"]],
        ]),
      } as never;
    });
    const baseContext = makeContext();
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue({
      ...baseContext,
      defaultTemplate: makeCombinedTemplate(),
      durabilityGateBlockers: [],
      batchesWithSamples: baseContext.batchesWithSamples.map((batch) => ({
        ...batch,
        durabilityOption: "1000_year" as const,
        samples: batch.samples.map((sample, index) => ({
          ...sample,
          totalCarbonPercent: 80 + index,
          sReflectanceFraction: 0.9 + index / 100,
        })),
      })),
      lineages: [
        makeLineage({
          applicationId: "app-early",
          code: "APP-TEST-001",
          applicationDate: new Date("2026-02-10T00:00:00Z"),
        }),
        makeLineage({
          applicationId: "app-late",
          code: "APP-TEST-002",
          applicationDate: new Date("2026-04-05T00:00:00Z"),
        }),
      ],
    });
    vi.mocked(isometric.createDatapoint).mockImplementation(
      fakeExternalIds("dp") as never,
    );
    vi.mocked(isometric.createGhgEntry).mockImplementation(
      fakeExternalIds("rmv") as never,
    );

    await submitRemoval({
      orgCtx: makeTestOrgContext(USER_ID),
      removalId: REMOVAL_ID,
      onProgress: progress,
    });

    expect(
      progress.mock.calls
        .map(([update]) => update)
        .filter((update) => update.step === "removal.sending_durability"),
    ).toEqual([
      {
        step: "removal.sending_durability",
        state: "active",
        completed: 0,
        total: 1,
      },
      {
        step: "removal.sending_durability",
        state: "active",
        completed: 1,
        total: 1,
      },
      {
        step: "removal.sending_durability",
        state: "complete",
        completed: 1,
        total: 1,
      },
    ]);

    // completed_on = the LATEST application date across lineages; started_on
    // stays the production start.
    const removalBody = vi.mocked(isometric.createGhgEntry).mock.calls[0][1];
    expect(removalBody.started_on).toBe("2026-01-01");
    expect(removalBody.completed_on).toBe("2026-04-05");
    expect(removalsDA.updateRemovalDates).toHaveBeenCalledWith(
      makeTestOrgContext(USER_ID),
      REMOVAL_ID,
      { startedOn: "2026-01-01", completedOn: "2026-04-05" },
    );

    // Caveat 1: the durability measurement samples keep production-end
    // `measured_at` (a lab/production-time measurement) — the application
    // anchor moves ONLY the GHG-entry window.
    const submitArgs = vi.mocked(
      durabilitySamples.submitDurabilityMeasurementSamples,
    ).mock.calls[0][0];
    expect(
      vi.mocked(
        durabilitySamples.submitDurabilityMeasurementSamples,
      ).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(isometric.createGhgEntry).mock.invocationCallOrder[0],
    );
    expect(submitArgs.sourceBindingPlan).toEqual([
      expect.objectContaining({
        sourceId: "src-test-1",
        nomaRole: "inventory",
        intendedTarget: expect.objectContaining({
          inputKey: "product_mass",
        }),
      }),
    ]);
    // Issue #630: the production batch is registered BEFORE the samples, in
    // kilograms with no invented standard deviation, and its `ptb_…` reaches
    // every per-batch sample body instead of the old `production_batch_id: null`.
    const postMock = vi.mocked(isometricClientFake.post);
    const productionBatchIndex = postMock.mock.calls.findIndex(
      ([path]) => path === "/production_batches",
    );
    expect(productionBatchIndex).toBeGreaterThanOrEqual(0);
    const productionBatchPost = postMock.mock.calls[productionBatchIndex];
    expect(productionBatchPost[1]).toMatchObject({
      kind: "biochar",
      facility_id: EXTERNAL_FACILITY_ID,
      feedstock_type_ids: [EXTERNAL_FEEDSTOCK_TYPE_ID],
      mass: { magnitude: ORIGINAL_BIOCHAR_MASS_KG, unit: "kg" },
      started_at: "2026-01-01T00:00:00.000Z",
      ended_at: "2026-01-31T23:59:59.999Z",
    });
    expect("standard_deviation" in productionBatchPost[1].mass).toBe(false);
    // Index the ordering off the matched call, not the first POST on the shared
    // fake: another request routed through it would otherwise silently move the
    // assertion onto the wrong call.
    expect(
      postMock.mock.invocationCallOrder[productionBatchIndex],
    ).toBeLessThan(
      vi.mocked(durabilitySamples.submitDurabilityMeasurementSamples).mock
        .invocationCallOrder[0],
    );
    expect(
      productionBatchesDA.upsertProductionBatchRegistration,
    ).toHaveBeenCalledTimes(1);

    expect(submitArgs.submissions.length).toBeGreaterThan(0);
    for (const submission of submitArgs.submissions) {
      expect(submission.body.production_batch_id).toBe(
        EXTERNAL_PRODUCTION_BATCH_ID,
      );
      expect(submission.body.measured_at).toBe("2026-01-31T23:59:59.000Z");
      expect(
        submission.body.values.filter(
          (value) =>
            value.measurement_property.qualifier === "inertinite_fraction",
        ).map((value) => value.value.magnitude),
      ).toEqual([0.9, 0.91, 0.92]);
    }

    const datapointBodies = vi.mocked(isometric.createDatapoint).mock.calls.map(
      (call) => call[1],
    );
    const sFractionDatapoints = datapointBodies.filter(
      (body) => body.display_name === "s_fraction",
    );
    expect(sFractionDatapoints.map((body) => body.quantity)).toEqual([
      { magnitude: 0.9, unit: "dimensionless" },
      { magnitude: 0.91, unit: "dimensionless" },
      { magnitude: 0.92, unit: "dimensionless" },
    ]);
    expect(
      new Set(sFractionDatapoints.map((body) => body.supplier_reference_id)).size,
    ).toBe(3);

    const sequestrationComponent =
      removalBody.ghg_entry_template_components?.find(
        (component) =>
          component.ghg_entry_template_component_id === "rtc-seq",
      );
    const sFractionInput = sequestrationComponent?.inputs.find(
      (input) => input.input_key === "s_fraction",
    );
    expect(sFractionInput).toEqual({
      __typename: "CreateComponentListInput",
      datapoint_ids: ["dp_1", "dp_2", "dp_3"],
      input_key: "s_fraction",
    });
  });

  it("allows an application dated the same UTC day as a mid-day production start (date-granular guard)", async () => {
    const ctx = makeContext();
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue({
      ...ctx,
      // Run starts mid-day; the form-entered application date is UTC midnight
      // of the SAME day. A millisecond comparison would wrongly block this
      // (issue #320 caveat 4) — the guard must compare at date granularity.
      runs: [
        {
          ...ctx.runs[0],
          startTime: new Date("2026-01-01T06:00:00Z"),
          endTime: new Date("2026-01-01T15:00:00Z"),
        },
      ],
      lineages: [
        makeLineage({
          applicationDate: new Date("2026-01-01T00:00:00Z"),
        }),
      ],
    });
    vi.mocked(isometric.createDatapoint).mockImplementation(
      fakeExternalIds("dp") as never,
    );
    vi.mocked(isometric.createGhgEntry).mockImplementation(
      fakeExternalIds("rmv") as never,
    );

    await submitRemoval({ orgCtx: makeTestOrgContext(USER_ID), removalId: REMOVAL_ID });

    const removalBody = vi.mocked(isometric.createGhgEntry).mock.calls[0][1];
    expect(removalBody.started_on).toBe("2026-01-01");
    expect(removalBody.completed_on).toBe("2026-01-01");
  });

  it("fails closed before any POST when the latest application predates production start", async () => {
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue({
      ...makeContext(),
      lineages: [
        makeLineage({
          applicationDate: new Date("2025-12-15T00:00:00Z"),
        }),
      ],
    });
    const createDatapointFake = vi.fn(fakeExternalIds("dp"));
    const createGhgEntryFake = vi.fn(fakeExternalIds("rmv"));
    vi.mocked(isometric.createDatapoint).mockImplementation(
      createDatapointFake as never,
    );
    vi.mocked(isometric.createGhgEntry).mockImplementation(
      createGhgEntryFake as never,
    );

    await expect(
      submitRemoval({ orgCtx: makeTestOrgContext(USER_ID), removalId: REMOVAL_ID }),
    ).rejects.toThrow(/correct the application date/i);
    // The guard names the offending application and runs BEFORE any registry
    // POST or ledger claim.
    expect(createDatapointFake).not.toHaveBeenCalled();
    expect(createGhgEntryFake).not.toHaveBeenCalled();
    expect(storedRows).toHaveLength(0);
  });

  it("rejects future production data before evidence, registry, or ledger mutations", async () => {
    const futureRun = {
      ...makeRun(ORIGINAL_BIOCHAR_MASS_KG),
      startTime: new Date("2099-01-01T08:00:00.000Z"),
      endTime: new Date("2099-01-01T16:00:00.000Z"),
    };
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue({
      ...makeContext(),
      runs: [futureRun],
      lineages: [
        makeLineage({
          applicationDate: new Date("2099-01-02T00:00:00.000Z"),
        }),
      ],
    });

    await expect(
      submitRemoval({
        orgCtx: makeTestOrgContext(USER_ID),
        removalId: REMOVAL_ID,
      }),
    ).rejects.toThrow(/latest production run ends at.*change the end time/i);

    expect(
      evidenceLedgers.ensureEvidenceLedgersFromContext,
    ).not.toHaveBeenCalled();
    expect(
      protocolPreflight.checkProtocolVersionAtSubmit,
    ).not.toHaveBeenCalled();
    expect(isometric.getIsometricClientForOrg).not.toHaveBeenCalled();
    expect(isometric.createDatapoint).not.toHaveBeenCalled();
    expect(isometric.createGhgEntry).not.toHaveBeenCalled();
    expect(storedRows).toHaveLength(0);
  });

  it("rejects a backdated application even when a later valid application carries the max date", async () => {
    // Mixed removal: the LATEST application (April) is after the earliest
    // production start (2026-01-01), so a max-date-only guard would pass —
    // the guard must scan every lineage and name the December offender.
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue({
      ...makeContext(),
      lineages: [
        makeLineage({
          applicationId: "app-backdated",
          code: "APP-TEST-001",
          applicationDate: new Date("2025-12-15T00:00:00Z"),
        }),
        makeLineage({
          applicationId: "app-valid",
          code: "APP-TEST-002",
          applicationDate: new Date("2026-04-05T00:00:00Z"),
        }),
      ],
    });
    const createDatapointFake = vi.fn(fakeExternalIds("dp"));
    const createGhgEntryFake = vi.fn(fakeExternalIds("rmv"));
    vi.mocked(isometric.createDatapoint).mockImplementation(
      createDatapointFake as never,
    );
    vi.mocked(isometric.createGhgEntry).mockImplementation(
      createGhgEntryFake as never,
    );

    await expect(
      submitRemoval({ orgCtx: makeTestOrgContext(USER_ID), removalId: REMOVAL_ID }),
    ).rejects.toThrow(/APP-TEST-001.*2025-12-15/);
    // Fails closed before any registry POST or ledger claim.
    expect(createDatapointFake).not.toHaveBeenCalled();
    expect(createGhgEntryFake).not.toHaveBeenCalled();
    expect(storedRows).toHaveLength(0);
  });
});

describe("submitRemoval — durability measurement-samples gate (sandbox-only)", () => {
  it("blocks a template that declares a biochar_sequestration_200_year_* component when the environment targets the live registry", async () => {
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue({
      ...makeContext(),
      defaultTemplate: makeSequestrationTemplate(),
    });
    const createDatapointFake = vi.fn(fakeExternalIds("dp"));
    vi.mocked(isometric.createDatapoint).mockImplementation(
      createDatapointFake as never,
    );

    await expect(
      submitRemoval({ orgCtx: makeTestOrgContext(USER_ID), removalId: REMOVAL_ID }),
    ).rejects.toThrow(/Durability submission is not available in the production registry yet/i);
    // Gated before any aggregation/claim — nothing posted, no ledger row.
    expect(createDatapointFake).not.toHaveBeenCalled();
    expect(storedRows).toHaveLength(0);
  });

  it("blocks the 1000-year component rather than silently omitting it when the environment targets the live registry", async () => {
    const ctx = makeContext();
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue({
      ...ctx,
      defaultTemplate: make1000YearSequestrationTemplate(),
      batchesWithSamples: ctx.batchesWithSamples.map((batch) => ({
        ...batch,
        durabilityOption: "1000_year" as const,
      })),
    });

    await expect(
      submitRemoval({
        orgCtx: makeTestOrgContext(USER_ID),
        removalId: REMOVAL_ID,
      }),
    ).rejects.toThrow(/Durability submission is not available in the production registry yet/i);

    expect(
      durabilitySamples.submitDurabilityMeasurementSamples,
    ).not.toHaveBeenCalled();
    expect(isometric.createGhgEntry).not.toHaveBeenCalled();
    expect(storedRows).toHaveLength(0);
  });

  it("rejects 200-year Removal submissions before any registry mutation or ledger claim against the sandbox", async () => {
    setDurabilityMeasurementSamplesEnabled(true);
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue({
      ...makeContext(),
      defaultTemplate: makeSequestrationTemplate(),
    });

    await expect(
      submitRemoval({
        orgCtx: makeTestOrgContext(USER_ID),
        removalId: REMOVAL_ID,
      }),
    ).rejects.toThrow(/200-year Removals cannot be submitted yet/i);

    expect(isometric.createDatapoint).not.toHaveBeenCalled();
    expect(
      durabilitySamples.submitDurabilityMeasurementSamples,
    ).not.toHaveBeenCalled();
    expect(isometric.createGhgEntry).not.toHaveBeenCalled();
    expect(storedRows).toHaveLength(0);
  });

  it("rejects unsampled Method B before any registry mutation or ledger claim against the sandbox", async () => {
    setDurabilityMeasurementSamplesEnabled(true);
    const ctx = makeContext();
    const unsampledBatches = ctx.batchesWithSamples.map((batch) => ({
      ...batch,
      durabilityOption: "1000_year" as const,
      sampling: "unsampled" as const,
    }));
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue({
      ...ctx,
      defaultTemplate: make1000YearSequestrationTemplate(),
      batchesWithSamples: unsampledBatches,
      memberBatches: ctx.memberBatches.map((batch) => ({
        ...batch,
        durabilityOption: "1000_year" as const,
        sampling: "unsampled" as const,
      })),
      // Exercise the submit payload builder's server-side capability guard
      // independently of the earlier readiness model.
      durabilityGateBlockers: [],
    });

    await expect(
      submitRemoval({
        orgCtx: makeTestOrgContext(USER_ID),
        removalId: REMOVAL_ID,
      }),
    ).rejects.toThrow(/Unsampled Method B Removals cannot be submitted yet/i);

    expect(isometric.createDatapoint).not.toHaveBeenCalled();
    expect(
      durabilitySamples.submitDurabilityMeasurementSamples,
    ).not.toHaveBeenCalled();
    expect(isometric.createGhgEntry).not.toHaveBeenCalled();
    expect(storedRows).toHaveLength(0);
  });
});
