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
  APPLICATION_ID,
  CHANGED_BIOCHAR_MASS_KG,
  CREDIT_BATCH_ID,
  EXTERNAL_PROJECT_ID,
  ORIGINAL_BIOCHAR_MASS_KG,
  PRODUCTION_RUN_ID,
  REMOVAL_ID,
  RTC_PRODUCT_MASS_ID,
  TEMPLATE_ID,
  USER_ID,
  durabilityBlockersFor,
  fakeExternalIds,
  makeBatchesWithSamples,
  makeContext,
  makeRun,
  storedRows,
} from "./fixtures/submit-removal-orchestrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reviewPayloadHash } from "@/lib/certification/removal-review-hash";
import * as ledger from "@/data-access/certification";
import * as removalsDA from "@/data-access/certifier-removals";
import * as certifyContext from "@/fn/certification/certify-context-core";
import * as evidenceLedgers from "@/fn/certification/ensure-evidence-ledgers";
import * as biocharApplications from "@/fn/certification/biochar-applications";
import * as protocolPreflight from "@/fn/certification/protocol-version-preflight";
import { submitRemoval } from "@/fn/certification/submit-removal";
import { compileRemovalSubmission } from "@/fn/certification/removal-submission-build";
import * as isometric from "@/lib/isometric";

function makeChangedProductionContext() {
  return makeContext(CHANGED_BIOCHAR_MASS_KG, {
    memberBatchClaims: [{
      creditBatchId: CREDIT_BATCH_ID,
      code: "CB-TEST-001",
      durabilityOption: "200_year",
      claimedByRemovalId: null,
      productionRunIds: [PRODUCTION_RUN_ID],
      applicationIds: [APPLICATION_ID],
      // These tests change upstream production mass, not the persisted
      // Application event or its immutable credit-batch slice.
      applicationSlices: [{
        applicationId: APPLICATION_ID,
        allocatedWetMassKg: ORIGINAL_BIOCHAR_MASS_KG,
        allocatedDryMassKg: ORIGINAL_BIOCHAR_MASS_KG,
      }],
    }],
  });
}
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
      makeChangedProductionContext(),
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
    const progress = vi.fn();

    const result = await submitRemoval({
      orgCtx: makeTestOrgContext(USER_ID),
      removalId: REMOVAL_ID,
      onProgress: progress,
    });

    expect(protocolPreflight.checkProtocolVersionAtSubmit).toHaveBeenCalledTimes(1);
    const protocolCheckOrder = vi.mocked(
      protocolPreflight.checkProtocolVersionAtSubmit,
    ).mock.invocationCallOrder[0];
    expect(protocolCheckOrder).toBeLessThan(
      vi.mocked(isometric.getIsometricClientForOrg).mock.invocationCallOrder[0],
    );
    expect(
      evidenceLedgers.ensureEvidenceLedgersFromContext,
    ).toHaveBeenCalledOnce();
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
      createGhgEntryFake.mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(biocharApplications.ensureRemovalBiocharApplications).mock
        .invocationCallOrder[0],
    );
    expect(
      vi.mocked(biocharApplications.ensureRemovalBiocharApplications).mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(ledger.markSubmissionSubmitted).mock
        .invocationCallOrder[0],
    );
    expect(progress).toHaveBeenCalledWith({
      step: "removal.sending_inputs",
      state: "active",
      completed: 0,
      total: 1,
    });
    expect(progress).toHaveBeenCalledWith({
      step: "removal.sending_inputs",
      state: "complete",
      completed: 1,
      total: 1,
    });
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

  it("keeps the ledger draft when Biochar Application association is incomplete", async () => {
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
      makeContext(),
    );
    vi.mocked(isometric.createDatapoint).mockImplementation(
      fakeExternalIds("dp") as never,
    );
    vi.mocked(isometric.createGhgEntry).mockImplementation(
      fakeExternalIds("rmv") as never,
    );
    vi.mocked(
      biocharApplications.ensureRemovalBiocharApplications,
    ).mockRejectedValue(
      new Error(
        "Isometric Biochar Application is not linked to a GHG Entry yet.",
      ),
    );

    await expect(
      submitRemoval({
        orgCtx: makeTestOrgContext(USER_ID),
        removalId: REMOVAL_ID,
      }),
    ).rejects.toThrow(/not linked to a GHG Entry yet/i);

    expect(storedRows[0]).toMatchObject({
      status: "draft",
      externalId: null,
    });
    expect(storedRows[0].lockedAt).not.toBeNull();
    expect(ledger.markSubmissionSubmitted).not.toHaveBeenCalled();
    expect(removalsDA.updateRemovalDates).not.toHaveBeenCalled();
  });

  it("keeps the ledger draft when the reporting window cannot be persisted", async () => {
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
      makeContext(),
    );
    vi.mocked(isometric.createDatapoint).mockImplementation(
      fakeExternalIds("dp") as never,
    );
    vi.mocked(isometric.createGhgEntry).mockImplementation(
      fakeExternalIds("rmv") as never,
    );
    vi.mocked(removalsDA.updateRemovalDates).mockRejectedValue(
      new Error("reporting window unavailable"),
    );

    await expect(
      submitRemoval({
        orgCtx: makeTestOrgContext(USER_ID),
        removalId: REMOVAL_ID,
      }),
    ).rejects.toThrow(/reporting window unavailable/i);

    expect(storedRows[0]).toMatchObject({
      status: "draft",
      externalId: null,
    });
    expect(storedRows[0].lockedAt).not.toBeNull();
    expect(ledger.markSubmissionSubmitted).not.toHaveBeenCalled();
  });

  it("keeps a confirmed submission when the attempt audit cannot be persisted", async () => {
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

    // The attempt summary is best-effort: a dead audit store must not turn a
    // confirmed registry submission into a thrown error, and must not unwind
    // or duplicate the submission.
    await expect(
      submitRemoval({
        orgCtx: makeTestOrgContext(USER_ID),
        removalId: REMOVAL_ID,
      }),
    ).resolves.toMatchObject({ externalId: "rmv_1" });

    expect(storedRows[0]).toMatchObject({
      status: "submitted",
      externalId: "rmv_1",
    });
    expect(attemptSummaryEvents()).toHaveLength(1);
    expect(isometric.createGhgEntry).toHaveBeenCalledTimes(1);

    // A retry with the audit store still down must not duplicate the
    // registry write.
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

  it("keeps the draft locked when a confirmed Removal write is followed by local persistence failure", async () => {
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
      makeContext(),
    );
    vi.mocked(isometric.createDatapoint).mockImplementation(
      fakeExternalIds("dp") as never,
    );
    vi.mocked(isometric.createGhgEntry).mockResolvedValue({
      id: "rmv_written",
    } as never);
    vi.mocked(ledger.markSubmissionSubmitted).mockRejectedValue(
      new Error("local ledger unavailable"),
    );

    await expect(
      submitRemoval({
        orgCtx: makeTestOrgContext(USER_ID),
        removalId: REMOVAL_ID,
      }),
    ).rejects.toThrow("local ledger unavailable");

    expect(storedRows[0]).toMatchObject({
      status: "draft",
      externalId: null,
    });
    expect(storedRows[0].lockedAt).not.toBeNull();
    expect(attemptSummaryEvents()[0]?.[1]).toMatchObject({
      responsePayload: { ghg_entry_external_mutation: "confirmed" },
    });
  });

  it("keeps the draft locked when a confirmed datapoint is followed by a definitive Removal refusal", async () => {
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
      makeContext(),
    );
    vi.mocked(isometric.createDatapoint).mockImplementation(
      fakeExternalIds("dp") as never,
    );
    vi.mocked(isometric.createGhgEntry).mockRejectedValue(
      new isometric.IsometricApiError(
        "422 Unprocessable",
        422,
        { errors: [{ detail: "invalid Removal payload" }] },
        "http",
      ),
    );

    await expect(
      submitRemoval({
        orgCtx: makeTestOrgContext(USER_ID),
        removalId: REMOVAL_ID,
      }),
    ).rejects.toThrow("invalid Removal payload");

    expect(storedRows[0].status).toBe("draft");
    expect(storedRows[0].lockedAt).not.toBeNull();
  });

  it("preserves a confirmed datapoint write through a lost Removal response and reconciliation", async () => {
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
        ghg_entry_external_mutation: "confirmed",
      },
    });
    expect(storedRows[0].status).toBe("draft");
    expect(storedRows[0].lockedAt).not.toBeNull();

    // Reconciliation is available after the preserved lock expires.
    storedRows[0].lockedAt = new Date(0);
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

    const progress = vi.fn();
    const second = await submitRemoval({
      orgCtx: makeTestOrgContext(USER_ID),
      removalId: REMOVAL_ID,
      onProgress: progress,
    });

    expect(second.externalId).toBe("rmv_1");
    expect(second.version).toBe(1);
    expect(isometric.createDatapoint).not.toHaveBeenCalled();
    expect(isometric.createGhgEntry).not.toHaveBeenCalled();
    // return-existing skips the ledger transition but reasserts the reporting
    // window so rows affected by the former early-finalization bug recover.
    expect(ledger.markSubmissionSubmitted).not.toHaveBeenCalled();
    expect(removalsDA.updateRemovalDates).toHaveBeenCalledWith(
      makeTestOrgContext(USER_ID),
      REMOVAL_ID,
      { startedOn: "2026-01-01", completedOn: "2026-04-05" },
    );
    // No new ledger row.
    expect(storedRows).toHaveLength(1);
    expect(progress).toHaveBeenCalledWith({
      step: "removal.sending_inputs",
      state: "reused",
    });
    expect(progress).toHaveBeenCalledWith({
      step: "removal.sending_durability",
      state: "skipped",
    });
    expect(progress).toHaveBeenCalledWith({
      step: "removal.creating",
      state: "reused",
    });
  });

  it("marks absent datapoint and durability work as skipped when reusing a Removal", async () => {
    const fixedOnlyTemplate = {
      ...makeContext().defaultTemplate!,
      groups: makeContext().defaultTemplate!.groups.map((group) => ({
        ...group,
        components: group.components.map((component) => ({
          ...component,
          inputs: component.inputs.map((input) => ({
            ...input,
            type: "fixed" as const,
            datapoint_id: "dtp-fixed-product-mass",
          })),
        })),
      })),
    } as IsometricGhgEntryTemplate;
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockImplementation(
      async () => makeContext(ORIGINAL_BIOCHAR_MASS_KG, {
        defaultTemplate: fixedOnlyTemplate,
      }),
    );
    vi.mocked(isometric.createGhgEntry).mockImplementation(
      fakeExternalIds("rmv") as never,
    );

    await submitRemoval({
      orgCtx: makeTestOrgContext(USER_ID),
      removalId: REMOVAL_ID,
    });
    const progress = vi.fn();
    await submitRemoval({
      orgCtx: makeTestOrgContext(USER_ID),
      removalId: REMOVAL_ID,
      onProgress: progress,
    });

    expect(isometric.createDatapoint).not.toHaveBeenCalled();
    expect(progress).toHaveBeenCalledWith({
      step: "removal.sending_inputs",
      state: "skipped",
    });
    expect(progress).toHaveBeenCalledWith({
      step: "removal.sending_durability",
      state: "skipped",
    });
    expect(progress).toHaveBeenCalledWith({
      step: "removal.creating",
      state: "reused",
    });
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
      makeChangedProductionContext(),
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
