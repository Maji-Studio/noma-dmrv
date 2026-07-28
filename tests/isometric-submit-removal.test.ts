/**
 * Happy-path orchestrator test for `submitRemoval`.
 *
 * Exercises the full Phase 3 submit pipeline end-to-end with the data-access
 * + Isometric HTTP boundaries faked but the orchestrator's transformers,
 * idempotency ledger logic, and payload construction running for real. The
 * other isometric-* tests cover the individual pieces (transformers,
 * payload-hash, submission-claim, certify-context); this one proves they
 * wire together correctly under `submitRemoval`.
 *
 * Coverage:
 *   1. First submit  → ledger draft → datapoint POST → removal POST →
 *                       ledger 'submitted' with externalId.
 *   2. Re-submit, no source change → `return-existing`, no new POSTs.
 *   3. Re-submit after a source change → supersede prior row, POST v=2.
 *
 * Out of scope (left to dedicated tests): partial-failure reconciliation,
 * the resume-from-locked-draft path, fixed-constant resolution, and the
 * sandbox/production gating switch.
 */
import type { IsometricGhgEntryTemplate } from "@/lib/isometric";
import { makeTestOrgContext } from "./helpers/test-org";
import {
  CHANGED_BIOCHAR_MASS_KG,
  CREDIT_BATCH_ID,
  EXTERNAL_PROJECT_ID,
  ORIGINAL_BIOCHAR_MASS_KG,
  REMOVAL_ID,
  RTC_PRODUCT_MASS_ID,
  TEMPLATE_ID,
  USER_ID,
  durabilityBlockersFor,
  fakeExternalIds,
  makeBatchesWithSamples,
  makeContext,
  makeLineage,
  makeRun,
  make1000YearSequestrationTemplate,
  makeSequestrationTemplate,
  setDurabilityMeasurementSamplesEnabled,
  storedRows,
} from "./fixtures/submit-removal-orchestrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reviewPayloadHash } from "@/lib/certification/removal-review-hash";
import * as ledger from "@/data-access/certification";
import * as removalsDA from "@/data-access/certifier-removals";
import * as certifyContext from "@/fn/certification/certify-context-core";
import * as durabilitySamples from "@/fn/certification/durability-measurement-samples";
import * as evidenceLedgers from "@/fn/certification/ensure-evidence-ledgers";
import * as protocolPreflight from "@/fn/certification/protocol-version-preflight";
import { submitRemoval } from "@/fn/certification/submit-removal";
import { compileRemovalSubmission } from "@/fn/certification/removal-submission-build";
import * as isometric from "@/lib/isometric";
import * as sourceVerification from "@/lib/isometric/source-binding-verification";
import { MAPPING_REVISION } from "@/lib/isometric/transformers/datapoint";

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
// Tests
// ---------------------------------------------------------------------------

function attemptSummaryEvents() {
  return vi
    .mocked(ledger.appendSyncEvent)
    .mock.calls.filter(
      ([, input]) => input.operation === "removal:submit:attempt-summary",
    );
}

describe("submitRemoval — happy path", () => {
  it("carries the reviewed compiler artifact through claim snapshot and POST, and refuses review drift", async () => {
    const ctx = makeContext();
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
      ctx,
    );
    const reviewed = await compileRemovalSubmission({
      orgCtx: makeTestOrgContext(USER_ID),
      removalId: REMOVAL_ID,
      ctx,
      defaultTemplate: ctx.defaultTemplate!,
      blueprintsByKey: new Map(
        ctx.blueprintsForTemplate.map((blueprint) => [
          blueprint.key,
          blueprint,
        ]),
      ),
      externalProjectId: ctx.mapping!.externalProjectId,
      allowPeriodInputStub: false,
      hasDurabilityComponents: false,
    });
    expect(reviewed.snapshot).not.toBeNull();
    // What the operator reviews and re-asserts at submit: Source-ID independent.
    const reviewedHash = reviewPayloadHash(
      reviewed.snapshot!.semanticPayload,
    );
    // What is persisted as the supersede / drift fingerprint: the full payload.
    const storedHash = isometric.payloadHash(
      reviewed.snapshot!.semanticPayload,
    );
    const repointed = await compileRemovalSubmission({
      orgCtx: makeTestOrgContext(USER_ID),
      removalId: REMOVAL_ID,
      ctx,
      defaultTemplate: ctx.defaultTemplate!,
      blueprintsByKey: new Map(
        ctx.blueprintsForTemplate.map((blueprint) => [
          blueprint.key,
          blueprint,
        ]),
      ),
      externalProjectId: "prj-repointed",
      allowPeriodInputStub: false,
      hasDurabilityComponents: false,
    });
    expect(
      reviewPayloadHash(repointed.snapshot!.semanticPayload),
    ).not.toBe(reviewedHash);
    vi.mocked(isometric.createDatapoint).mockImplementation(
      fakeExternalIds("dp") as never,
    );
    vi.mocked(isometric.createGhgEntry).mockImplementation(
      fakeExternalIds("rmv") as never,
    );

    await submitRemoval({
      orgCtx: makeTestOrgContext(USER_ID),
      removalId: REMOVAL_ID,
      expectedCompilationHash: reviewedHash,
    });

    expect(storedRows[0].payloadHash).toBe(storedHash);
    expect(storedRows[0].payloadSnapshot).toMatchObject({
      semantic: reviewed.snapshot!.semanticPayload,
    });
    expect(
      (
        storedRows[0].payloadSnapshot as {
          transport: { datapointBodies: Array<{ body: unknown }> };
        }
      ).transport.datapointBodies[0]?.body,
    ).toEqual(vi.mocked(isometric.createDatapoint).mock.calls[0][1]);

    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
      makeContext(CHANGED_BIOCHAR_MASS_KG),
    );
    await expect(
      submitRemoval({
        orgCtx: makeTestOrgContext(USER_ID),
        removalId: REMOVAL_ID,
        expectedCompilationHash: reviewedHash,
      }),
    ).rejects.toThrow(/changed after you reviewed it/i);
    expect(storedRows).toHaveLength(1);
    expect(isometric.createGhgEntry).toHaveBeenCalledTimes(1);
  });

  it("inserts a v=1 draft, POSTs one datapoint + the removal, then marks the ledger submitted", async () => {
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
      makeContext(),
    );
    const createDatapointFake = vi.fn(fakeExternalIds("dp"));
    const createGhgEntryFake = vi.fn(fakeExternalIds("rmv"));
    vi.mocked(isometric.createDatapoint).mockImplementation(
      createDatapointFake as never,
    );
    vi.mocked(isometric.createGhgEntry).mockImplementation(
      createGhgEntryFake as never,
    );

    const result = await submitRemoval({ orgCtx: makeTestOrgContext(USER_ID), removalId: REMOVAL_ID });

    expect(protocolPreflight.checkProtocolVersionAtSubmit).toHaveBeenCalledTimes(1);
    const protocolCheckOrder = vi.mocked(
      protocolPreflight.checkProtocolVersionAtSubmit,
    ).mock.invocationCallOrder[0];
    expect(protocolCheckOrder).toBeLessThan(
      vi.mocked(isometric.getIsometricClientForOrg).mock.invocationCallOrder[0],
    );
    expect(
      evidenceLedgers.ensureEvidenceLedgersFromContext,
    ).not.toHaveBeenCalled();
    expect(protocolCheckOrder).toBeLessThan(
      createDatapointFake.mock.invocationCallOrder[0],
    );

    // Ledger transitioned draft → submitted; externalId matches the fake.
    expect(storedRows).toHaveLength(1);
    expect(storedRows[0]).toMatchObject({
      version: 1,
      status: "submitted",
      externalId: "rmv_1",
    });
    expect(result).toMatchObject({
      removalId: REMOVAL_ID,
      externalId: "rmv_1",
      version: 1,
    });
    expect(storedRows[0].payloadSnapshot).toMatchObject({
      __mappingRevision: MAPPING_REVISION,
      semantic: { mappingRevision: MAPPING_REVISION },
    });

    // One datapoint POST (the only monitored input) + one removal POST.
    expect(createDatapointFake).toHaveBeenCalledTimes(1);
    expect(createGhgEntryFake).toHaveBeenCalledTimes(1);
    expect(
      sourceVerification.verifyRemovalSourceBindings,
    ).toHaveBeenCalledWith(
      expect.anything(),
      "rmv_1",
      [
        expect.objectContaining({
          sourceId: "src-test-1",
          nomaRole: "inventory",
          intendedTarget: expect.objectContaining({
            componentId: RTC_PRODUCT_MASS_ID,
            inputKey: "product_mass",
          }),
        }),
      ],
    );
    expect(
      vi.mocked(isometric.createGhgEntry).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(sourceVerification.verifyRemovalSourceBindings).mock
        .invocationCallOrder[0],
    );

    // Datapoint payload reflects the aggregated product mass + the input's
    // unit/quantity-kind mapping. Per `INPUT_MAPPING` for
    // co2-stored/carbon_rich_substance_sequestration/product_mass. Read
    // through the mocked module so vitest preserves the upstream call type.
    const datapointBody = vi.mocked(isometric.createDatapoint).mock.calls[0][1];
    expect(datapointBody).toMatchObject({
      project_id: EXTERNAL_PROJECT_ID,
      type: "REPORTED",
      quantity: { magnitude: ORIGINAL_BIOCHAR_MASS_KG, unit: "kg" },
      source_ids: ["src-test-1"],
    });
    expect(datapointBody.supplier_reference_id).toMatch(/^nm-/);
    expect(
      (
        storedRows[0].payloadSnapshot as {
          transport: { datapointBodies: Array<{ body: unknown }> };
        }
      ).transport.datapointBodies[0]?.body,
    ).toEqual(datapointBody);

    // Removal payload wires the datapoint id back onto the component. The
    // window ends at the application date (§8.6.2, issue #320), not the
    // production end (2026-01-31).
    const removalBody = vi.mocked(isometric.createGhgEntry).mock.calls[0][1];
    expect(removalBody).toMatchObject({
      project_id: EXTERNAL_PROJECT_ID,
      ghg_entry_template_id: TEMPLATE_ID,
      started_on: "2026-01-01",
      completed_on: "2026-04-05",
    });
    expect(removalBody.ghg_entry_template_components ?? []).toHaveLength(1);
    expect(removalBody.ghg_entry_template_components?.[0]).toMatchObject({
      ghg_entry_template_component_id: RTC_PRODUCT_MASS_ID,
      inputs: [
        {
          __typename: "CreateComponentScalarInput",
          datapoint_id: "dp_1",
          input_key: "product_mass",
        },
      ],
    });

    // Reporting window was persisted onto the removal row — completedOn
    // carries the application date, keeping every period consumer (detail
    // sheet, GHG-statement partition, dashboard) on the §8.6.2 window.
    expect(removalsDA.updateRemovalDates).toHaveBeenCalledWith(
      makeTestOrgContext(USER_ID),
      REMOVAL_ID,
      { startedOn: "2026-01-01", completedOn: "2026-04-05" },
    );
    expect(attemptSummaryEvents()).toHaveLength(1);
    expect(attemptSummaryEvents()[0]?.[1]).toMatchObject({
      status: "succeeded",
      responsePayload: {
        outcome: "succeeded",
        error_class: null,
        error_message: null,
        ghg_entry_external_mutation: "confirmed",
      },
    });
  });

  it("fails loudly on attempt-audit persistence without unwinding or duplicating a confirmed submission", async () => {
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
      makeContext(),
    );
    vi.mocked(isometric.createDatapoint).mockImplementation(
      fakeExternalIds("dp") as never,
    );
    vi.mocked(isometric.createGhgEntry).mockImplementation(
      fakeExternalIds("rmv") as never,
    );
    vi.mocked(ledger.appendSyncEvent).mockRejectedValue(
      new Error("audit database unavailable"),
    );

    await expect(
      submitRemoval({
        orgCtx: makeTestOrgContext(USER_ID),
        removalId: REMOVAL_ID,
      }),
    ).rejects.toThrow(/audit database unavailable/i);

    expect(storedRows[0]).toMatchObject({
      status: "submitted",
      externalId: "rmv_1",
    });
    expect(attemptSummaryEvents()).toHaveLength(1);

    vi.mocked(ledger.appendSyncEvent).mockResolvedValue(undefined as never);
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
      makeContext(),
    );
    await expect(
      submitRemoval({
        orgCtx: makeTestOrgContext(USER_ID),
        removalId: REMOVAL_ID,
      }),
    ).resolves.toMatchObject({ externalId: "rmv_1" });
    expect(isometric.createGhgEntry).toHaveBeenCalledTimes(1);
  });

  it("records possible for a lost GHG Entry response and confirmed when reconciliation finds it", async () => {
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
      makeContext(),
    );
    vi.mocked(isometric.createDatapoint).mockImplementation(
      fakeExternalIds("dp") as never,
    );
    vi.mocked(isometric.createGhgEntry).mockRejectedValue(
      new Error("connection reset after write"),
    );

    await expect(
      submitRemoval({
        orgCtx: makeTestOrgContext(USER_ID),
        removalId: REMOVAL_ID,
      }),
    ).rejects.toThrow(/Removal POST failed/i);
    expect(attemptSummaryEvents()).toHaveLength(1);
    expect(attemptSummaryEvents()[0]?.[1]).toMatchObject({
      responsePayload: {
        outcome: "failed",
        ghg_entry_external_mutation: "possible",
      },
    });

    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
      makeContext(),
    );
    vi.mocked(isometric.reconcileRemoval).mockResolvedValue({
      found: true,
      externalId: "rmv_reconciled",
    });
    const reconciled = await submitRemoval({
      orgCtx: makeTestOrgContext(USER_ID),
      removalId: REMOVAL_ID,
    });
    expect(reconciled.externalId).toBe("rmv_reconciled");
    expect(storedRows[0]).toMatchObject({
      status: "submitted",
      externalId: "rmv_reconciled",
    });
    expect(attemptSummaryEvents()).toHaveLength(2);
    expect(attemptSummaryEvents()[1]?.[1]).toMatchObject({
      responsePayload: {
        outcome: "succeeded",
        ghg_entry_external_mutation: "confirmed",
      },
    });
  });

  it("re-submitting with identical source data returns the existing externalId and POSTs nothing new", async () => {
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
      makeContext(),
    );
    vi.mocked(isometric.createDatapoint).mockImplementation(
      fakeExternalIds("dp") as never,
    );
    vi.mocked(isometric.createGhgEntry).mockImplementation(
      fakeExternalIds("rmv") as never,
    );

    await submitRemoval({ orgCtx: makeTestOrgContext(USER_ID), removalId: REMOVAL_ID });

    // Reset the HTTP spies — the second submit must not call them.
    vi.mocked(isometric.createDatapoint).mockClear();
    vi.mocked(isometric.createGhgEntry).mockClear();
    // Also clear the local-persistence spies so we can assert that
    // return-existing skips them outright on the second submit.
    vi.mocked(ledger.markSubmissionSubmitted).mockClear();
    vi.mocked(removalsDA.updateRemovalDates).mockClear();
    // The fresh context now carries the latest submitted row from the first
    // call, which is what `decideSubmissionClaim` reads to recognise the
    // already-submitted state.
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
      makeContext(),
    );

    const second = await submitRemoval({
      orgCtx: makeTestOrgContext(USER_ID),
      removalId: REMOVAL_ID,
    });

    expect(second.externalId).toBe("rmv_1");
    expect(second.version).toBe(1);
    expect(isometric.createDatapoint).not.toHaveBeenCalled();
    expect(isometric.createGhgEntry).not.toHaveBeenCalled();
    // return-existing must also skip local persistence — no ledger
    // transition, no removal-date rewrite.
    expect(ledger.markSubmissionSubmitted).not.toHaveBeenCalled();
    expect(removalsDA.updateRemovalDates).not.toHaveBeenCalled();
    // No new ledger row.
    expect(storedRows).toHaveLength(1);
    // …but the §8.6.2 claim IS lazily stamped (ADR 0020): a removal
    // submitted before the claim column existed would otherwise never
    // record its production-emissions claim (the guarded UPDATE is
    // idempotent for the already-stamped common case).
    expect(ledger.stampProductionEmissionsClaim).toHaveBeenCalledWith(
      makeTestOrgContext(USER_ID),
      { removalId: REMOVAL_ID, creditBatchIds: [CREDIT_BATCH_ID] },
    );
  });

  it("supersedes to v=2 when the aggregated source data changes between submits", async () => {
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
      makeContext(ORIGINAL_BIOCHAR_MASS_KG),
    );
    vi.mocked(isometric.createDatapoint).mockImplementation(
      fakeExternalIds("dp") as never,
    );
    vi.mocked(isometric.createGhgEntry).mockImplementation(
      fakeExternalIds("rmv") as never,
    );

    await submitRemoval({ orgCtx: makeTestOrgContext(USER_ID), removalId: REMOVAL_ID });
    const firstRowId = storedRows[0].id;

    // Second submit sees a changed run mass → a different payload hash →
    // `create-new-version` with `supersedePreviousId` set.
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
      makeContext(CHANGED_BIOCHAR_MASS_KG),
    );

    const second = await submitRemoval({
      orgCtx: makeTestOrgContext(USER_ID),
      removalId: REMOVAL_ID,
    });

    expect(second.version).toBe(2);
    expect(second.externalId).toBe("rmv_2");

    expect(storedRows).toHaveLength(2);
    const v1 = storedRows.find((r) => r.id === firstRowId)!;
    const v2 = storedRows.find((r) => r.id !== firstRowId)!;
    expect(v1.status).toBe("superseded");
    expect(v1.supersededAt).not.toBeNull();
    expect(v2).toMatchObject({
      version: 2,
      status: "submitted",
      externalId: "rmv_2",
    });

    // The v=2 datapoint payload reflects the new mass.
    const datapointCalls = vi.mocked(isometric.createDatapoint).mock.calls;
    expect(datapointCalls).toHaveLength(2);
    expect(datapointCalls[1][1].quantity).toEqual({
      magnitude: CHANGED_BIOCHAR_MASS_KG,
      unit: "kg",
    });
  });
});

// ---------------------------------------------------------------------------
// Phase H — durability gate wiring (D3). Proves the fail-closed gates actually
// fire through submitRemoval, before any registry POST, not just at the unit
// layer (durability-submission-gates.test.ts).
// ---------------------------------------------------------------------------

describe("submitRemoval — durability sampling gates (D3)", () => {
  function contextWithRun(run: ReturnType<typeof makeRun>) {
    // submitRemoval blocks on the precomputed `durabilityGateBlockers` (which
    // `buildRemovalContext` derives via the same engine), so recompute it for
    // the overridden run to drive the fail-closed path.
    const batchesWithSamples = makeBatchesWithSamples([run]);
    return {
      ...makeContext(),
      runs: [run],
      batchesWithSamples,
      durabilityGateBlockers: durabilityBlockersFor(batchesWithSamples),
    };
  }

  it("blocks a Method A run with no samples before any POST", async () => {
    const run = { ...makeRun(ORIGINAL_BIOCHAR_MASS_KG), samples: [] };
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
      contextWithRun(run),
    );
    const createDatapointFake = vi.fn(fakeExternalIds("dp"));
    vi.mocked(isometric.createDatapoint).mockImplementation(
      createDatapointFake as never,
    );

    await expect(
      submitRemoval({ orgCtx: makeTestOrgContext(USER_ID), removalId: REMOVAL_ID }),
    ).rejects.toThrow(/Sample and eligibility issues/i);
    // Failed closed — nothing was posted and no ledger row was claimed.
    expect(createDatapointFake).not.toHaveBeenCalled();
    expect(storedRows).toHaveLength(0);
  });

  it("blocks a sampled run with fewer than 3 replicates", async () => {
    const full = makeRun(ORIGINAL_BIOCHAR_MASS_KG);
    const run = { ...full, samples: full.samples.slice(0, 2) };
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
      contextWithRun(run),
    );
    const createDatapointFake = vi.fn(fakeExternalIds("dp"));
    vi.mocked(isometric.createDatapoint).mockImplementation(
      createDatapointFake as never,
    );

    await expect(
      submitRemoval({ orgCtx: makeTestOrgContext(USER_ID), removalId: REMOVAL_ID }),
    ).rejects.toThrow(/2 Samples with complete H\/C_org and O\/C_org results/i);
    // Failed closed — nothing was posted and no ledger row was claimed.
    expect(createDatapointFake).not.toHaveBeenCalled();
    expect(storedRows).toHaveLength(0);
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

  it("uses MAX(applicationDate) across lineages for completed_on while durability measured_at keeps the production end", async () => {
    setDurabilityMeasurementSamplesEnabled(true);
    vi.mocked(
      durabilitySamples.submitDurabilityMeasurementSamples,
    ).mockResolvedValue({
      submitted: 1,
      samples: [],
      datapointIdsByMeasurementProperty: new Map([
        [
          "mass_fraction_dry_basis|total_carbon",
          ["dtp-carbon-1", "dtp-carbon-2", "dtp-carbon-3"],
        ],
        ["mass", ["dtp-product-mass"]],
      ]),
    } as never);
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

    await submitRemoval({ orgCtx: makeTestOrgContext(USER_ID), removalId: REMOVAL_ID });

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
    expect(submitArgs.submissions.length).toBeGreaterThan(0);
    for (const submission of submitArgs.submissions) {
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
      runs: [{ ...ctx.runs[0], startTime: new Date("2026-01-01T06:00:00Z") }],
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
