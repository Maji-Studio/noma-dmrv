import {
  APPLICATION_ID,
  CHANGED_BIOCHAR_MASS_KG,
  CREDIT_BATCH_ID,
  ORIGINAL_BIOCHAR_MASS_KG,
  PRODUCTION_RUN_ID,
  REMOVAL_ID,
  USER_ID,
  fakeExternalIds,
  isometricClientFake,
  makeContext,
  makeFreshScope,
  newLedgerRow,
  storedRows,
} from "./fixtures/submit-removal-orchestrator";
import { describe, expect, it, vi } from "vitest";
import { makeTestOrgContext } from "./helpers/test-org";
import * as ledger from "@/data-access/certification";
import * as ledgerClaim from "@/data-access/certification-submissions";
import * as certifyContext from "@/fn/certification/certify-context-core";
import * as removalsDA from "@/data-access/certifier-removals";
import { submitRemoval } from "@/fn/certification/submit-removal";
import * as isometric from "@/lib/isometric";
import { SafeError } from "@/lib/errors";
import { buildMassAccounting } from "@/lib/certification/mass-accounting";

const CHANGED_RUN_OUTPUT_MASS_KG = 500;
const CHANGED_FEEDSTOCK_MASS_KG = 5000;
const CHANGED_ORGANIC_CARBON_PERCENT = 75;
const ORIGINAL_ORGANIC_CARBON_FRACTION = 0.8;
const CHANGED_PRODUCTION_START = "2026-01-02T00:00:00.000Z";
const CHANGED_APPLICATION_DATE = "2026-04-06T00:00:00.000Z";
const SOURCE_DRIFT_MESSAGE =
  "Removal source data changed while preparing this submission. The stale draft was retired; reload and submit again.";

function makePayloadDriftContext() {
  // Grafted carbon_content / feedstock_mass stand in for any chemistry- or mass-bound input; production 200-year templates bind total_carbon_contents / inorganic_carbon_contents instead.
  const ctx = makeContext();
  const template = ctx.defaultTemplate!;
  const storageGroup = template.groups[0];
  const storageComponent = storageGroup.components[0];
  const massInput = storageComponent.inputs[0];
  const storageBlueprint = ctx.blueprintsForTemplate[0];
  const massBlueprintInput = storageBlueprint.inputs[0];
  return {
    ...ctx,
    defaultTemplate: {
      ...template,
      groups: [
        {
          ...storageGroup,
          components: [{
            ...storageComponent,
            inputs: [massInput, {
              ...massInput,
              input_key: "carbon_content",
              display_name: "Organic carbon content",
              quantity_kind: "dimensionless" as const,
            }],
          }],
        },
        {
          ...storageGroup,
          id: "grp-feedstock",
          key: "biomass-feedstock-transport",
          display_name: "Feedstock transport",
          components: [{
            ...storageComponent,
            id: "rtc-feedstock-mass",
            ghg_entry_template_component_group_id: "grp-feedstock",
            blueprint_key: "specific_volume_based_emissions",
            display_name: "Feedstock mass",
            inputs: [{ ...massInput, input_key: "feedstock_mass" }],
          }],
        },
      ],
    },
    blueprintsForTemplate: [
      {
        ...storageBlueprint,
        inputs: [massBlueprintInput, {
          ...massBlueprintInput,
          input_key: "carbon_content",
          quantity_kind: "dimensionless" as const,
          compatible_unit: "dimensionless",
        }],
      },
      {
        ...storageBlueprint,
        key: "specific_volume_based_emissions",
        inputs: [{ ...massBlueprintInput, input_key: "feedstock_mass" }],
      },
    ],
  } satisfies certifyContext.RemovalSubmissionContext;
}

// ---------------------------------------------------------------------------
// Issue #349 / ADR 0020 — §8.6.2 production-emissions front-loading. A credit
// batch's production-bucket emissions submit exactly once: the first successful
// submit stamps the claiming removal onto the batch; later Removals may reuse
// its applied mass without submitting the production bucket again.
// ---------------------------------------------------------------------------

describe("submitRemoval — production-emissions claim gate (§8.6.2, issue #349)", () => {
  it("submits a follow-up Removal without claiming production again", async () => {
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
      makeContext(ORIGINAL_BIOCHAR_MASS_KG, {
        memberBatchClaims: [
          {
            creditBatchId: CREDIT_BATCH_ID,
            code: "CB-TEST-001",
            durabilityOption: "200_year",
            claimedByRemovalId: "rem-other",
            productionRunIds: [PRODUCTION_RUN_ID],
            applicationIds: [APPLICATION_ID],
            applicationSlices: [{
              applicationId: APPLICATION_ID,
              allocatedWetMassKg: ORIGINAL_BIOCHAR_MASS_KG,
              allocatedDryMassKg: ORIGINAL_BIOCHAR_MASS_KG,
            }],
          },
        ],
      }),
    );
    const createDatapointFake = vi.fn(fakeExternalIds("dp"));
    const createGhgEntryFake = vi.fn(fakeExternalIds("rmv"));
    vi.mocked(isometric.createDatapoint).mockImplementation(
      createDatapointFake as never,
    );
    vi.mocked(isometric.createGhgEntry).mockImplementation(
      createGhgEntryFake as never,
    );
    vi.mocked(certifyContext.resolveScopeForRemoval).mockResolvedValue(
      makeFreshScope({ claimedByRemovalId: "rem-other" }),
    );

    await submitRemoval({
      orgCtx: makeTestOrgContext(USER_ID),
      removalId: REMOVAL_ID,
    });
    expect(createGhgEntryFake).toHaveBeenCalledOnce();
    expect(ledger.markSubmissionSubmitted).toHaveBeenCalledWith(
      makeTestOrgContext(USER_ID),
      storedRows[0].id,
      expect.objectContaining({
        productionEmissionsClaim: {
          removalId: REMOVAL_ID,
          creditBatchIds: [],
        },
      }),
    );
  });

  it("records the claim on the member batches when the ledger flips to submitted", async () => {
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

    expect(ledger.markSubmissionSubmitted).toHaveBeenCalledWith(
      makeTestOrgContext(USER_ID),
      storedRows[0].id,
      expect.objectContaining({
        productionEmissionsClaim: {
          removalId: REMOVAL_ID,
          creditBatchIds: [CREDIT_BATCH_ID],
        },
      }),
    );
  });

  it("claims only the unclaimed batch in a mixed follow-up Removal", async () => {
    const secondBatchId = "33333333-3333-4333-8333-333333333333";
    const memberBatchClaims = [
      {
        creditBatchId: CREDIT_BATCH_ID,
        code: "Batch A",
        durabilityOption: "200_year" as const,
        claimedByRemovalId: "removal-r-001",
        productionRunIds: [PRODUCTION_RUN_ID],
        applicationIds: [APPLICATION_ID],
        applicationSlices: [{
          applicationId: APPLICATION_ID,
          allocatedWetMassKg: ORIGINAL_BIOCHAR_MASS_KG / 2,
          allocatedDryMassKg: ORIGINAL_BIOCHAR_MASS_KG / 2,
        }],
      },
      {
        creditBatchId: secondBatchId,
        code: "Batch B",
        durabilityOption: "200_year" as const,
        claimedByRemovalId: null,
        productionRunIds: [PRODUCTION_RUN_ID],
        applicationIds: [APPLICATION_ID],
        applicationSlices: [{
          applicationId: APPLICATION_ID,
          allocatedWetMassKg: ORIGINAL_BIOCHAR_MASS_KG / 2,
          allocatedDryMassKg: ORIGINAL_BIOCHAR_MASS_KG / 2,
        }],
      },
    ];
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
      makeContext(ORIGINAL_BIOCHAR_MASS_KG, { memberBatchClaims }),
    );
    vi.mocked(certifyContext.resolveScopeForRemoval).mockResolvedValue({
      ...makeFreshScope({ claimedByRemovalId: "removal-r-001" }),
      memberBatches: memberBatchClaims.map((batch) => ({
        id: batch.creditBatchId,
        code: batch.code,
        productionRunIds: batch.productionRunIds,
        applicationIds: batch.applicationIds,
        durabilityOption: "200_year",
        productionEmissionsClaimedByRemovalId: batch.claimedByRemovalId,
      })),
    } as never);
    vi.mocked(isometric.createDatapoint).mockImplementation(
      fakeExternalIds("dp") as never,
    );
    vi.mocked(isometric.createGhgEntry).mockImplementation(
      fakeExternalIds("rmv") as never,
    );

    await submitRemoval({
      orgCtx: makeTestOrgContext(USER_ID),
      removalId: REMOVAL_ID,
    });

    expect(ledger.markSubmissionSubmitted).toHaveBeenCalledWith(
      makeTestOrgContext(USER_ID),
      storedRows[0].id,
      expect.objectContaining({
        productionEmissionsClaim: {
          removalId: REMOVAL_ID,
          creditBatchIds: [secondBatchId],
        },
      }),
    );
  });

  it("keeps claiming on a supersede re-submit by the same removal", async () => {
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

    // Second submit: the batch is now claimed by THIS removal (the first
    // submit stamped it) and the source mass changed → v=2 supersede. The
    // self-claim must not block — in the pre-flight gate NOR the post-claim
    // fresh-read re-assert — and the claim arg rides again (idempotent
    // guarded UPDATE on the data-access side).
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
      makeContext(CHANGED_BIOCHAR_MASS_KG, {
        memberBatchClaims: [
          {
            creditBatchId: CREDIT_BATCH_ID,
            code: "CB-TEST-001",
            durabilityOption: "200_year",
            claimedByRemovalId: REMOVAL_ID,
            productionRunIds: [PRODUCTION_RUN_ID],
            applicationIds: [APPLICATION_ID],
            applicationSlices: [{
              applicationId: APPLICATION_ID,
              allocatedWetMassKg: ORIGINAL_BIOCHAR_MASS_KG,
              allocatedDryMassKg: ORIGINAL_BIOCHAR_MASS_KG,
            }],
          },
        ],
      }),
    );
    vi.mocked(certifyContext.resolveScopeForRemoval).mockResolvedValue(
      makeFreshScope({ claimedByRemovalId: REMOVAL_ID }),
    );

    const second = await submitRemoval({
      orgCtx: makeTestOrgContext(USER_ID),
      removalId: REMOVAL_ID,
    });

    expect(second.version).toBe(2);
    const lastCall = vi
      .mocked(ledger.markSubmissionSubmitted)
      .mock.calls.at(-1);
    expect(lastCall?.[2]).toMatchObject({
      productionEmissionsClaim: {
        removalId: REMOVAL_ID,
        creditBatchIds: [CREDIT_BATCH_ID],
      },
    });
  });

  it("blocks a mid-flight production-claim change before any POST", async () => {
    // TOCTOU window: the pre-flight context still says unclaimed…
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
      makeContext(),
    );
    // …but by the time the draft row is claimed, the DB says a DIFFERENT
    // removal stamped the batch (regroup + foreign submit in the window).
    vi.mocked(certifyContext.resolveScopeForRemoval).mockResolvedValue(
      makeFreshScope({ claimedByRemovalId: "rem-other" }),
    );
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
    ).rejects.toThrow(/production claim changed/);
    // Blocked AFTER the draft claim but BEFORE any registry POST. With no
    // external mutation to reconcile, the claimed row records a failed attempt
    // and unlocks instead of looking perpetually in progress.
    expect(createDatapointFake).not.toHaveBeenCalled();
    expect(createGhgEntryFake).not.toHaveBeenCalled();
    expect(storedRows).toHaveLength(1);
    expect(storedRows[0].status).toBe("rejected");
    expect(ledger.markSubmissionRejected).toHaveBeenCalled();
    expect(ledger.markSubmissionSubmitted).not.toHaveBeenCalled();
  });

  it("lets only the earliest active draft claim shared production inputs", async () => {
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
      makeContext(),
    );
    vi.mocked(removalsDA.listProductionClaimDraftContenders).mockResolvedValue([
      {
        creditBatchId: CREDIT_BATCH_ID,
        removalId: "removal-r-001",
        submissionId: "submission-r-001",
        createdAt: new Date("2026-08-15T10:00:00Z"),
      },
    ]);
    const createDatapointFake = vi.fn(fakeExternalIds("dp"));
    const createGhgEntryFake = vi.fn(fakeExternalIds("rmv"));
    vi.mocked(isometric.createDatapoint).mockImplementation(
      createDatapointFake as never,
    );
    vi.mocked(isometric.createGhgEntry).mockImplementation(
      createGhgEntryFake as never,
    );

    await expect(
      submitRemoval({
        orgCtx: makeTestOrgContext(USER_ID),
        removalId: REMOVAL_ID,
      }),
    ).rejects.toThrow(/Another Removal started claiming production inputs/i);
    expect(createDatapointFake).not.toHaveBeenCalled();
    expect(createGhgEntryFake).not.toHaveBeenCalled();
    expect(ledger.markSubmissionSubmitted).not.toHaveBeenCalled();
  });

  it("fails closed before any POST when the batch's run lineage changed between context load and the draft claim", async () => {
    // The payload was built from a context whose batch carried ONE run…
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
      makeContext(),
    );
    // …but by the time the draft row froze membership, a regroup had added a
    // second run to the batch — the built payload no longer covers the
    // batch's production bucket, so stamping the claim would under-claim.
    vi.mocked(certifyContext.resolveScopeForRemoval).mockResolvedValue(
      makeFreshScope({
        claimedByRemovalId: null,
        productionRunIds: [PRODUCTION_RUN_ID, "pr-added-in-window"],
      }),
    );
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
    ).rejects.toThrow(/membership, run lineage, or production claim changed/);
    expect(createDatapointFake).not.toHaveBeenCalled();
    expect(createGhgEntryFake).not.toHaveBeenCalled();
    expect(ledger.markSubmissionSubmitted).not.toHaveBeenCalled();
  });

  it("retires the draft before any POST when same-ID source data changes after context load", async () => {
    vi.mocked(certifyContext.loadRemovalSubmissionContext)
      // Payload and snapshot are built from the original context.
      .mockResolvedValueOnce(makeContext(ORIGINAL_BIOCHAR_MASS_KG))
      // The post-draft freshness rebuild sees the same IDs with changed mass.
      .mockResolvedValue(
        makeContext(CHANGED_BIOCHAR_MASS_KG, {
          memberBatchClaims: [{
            creditBatchId: CREDIT_BATCH_ID,
            code: "CB-TEST-001",
            durabilityOption: "200_year",
            claimedByRemovalId: null,
            productionRunIds: [PRODUCTION_RUN_ID],
            applicationIds: [APPLICATION_ID],
            // The Application itself is unchanged; only upstream production
            // source data drifts in this freshness regression.
            applicationSlices: [{
              applicationId: APPLICATION_ID,
              allocatedWetMassKg: ORIGINAL_BIOCHAR_MASS_KG,
              allocatedDryMassKg: ORIGINAL_BIOCHAR_MASS_KG,
            }],
          }],
        }),
      );
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
    ).rejects.toThrow(/source data changed/i);
    expect(createDatapointFake).not.toHaveBeenCalled();
    expect(createGhgEntryFake).not.toHaveBeenCalled();
    expect(storedRows).toHaveLength(1);
    expect(storedRows[0].status).toBe("superseded");
    expect(ledger.retireStaleSubmissionDraft).toHaveBeenCalledWith(
      makeTestOrgContext(USER_ID),
      storedRows[0].id,
      expect.objectContaining({
        reason: expect.stringContaining("semantic payload drift"),
      }),
    );
    expect(ledger.markSubmissionSubmitted).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "member production run biochar dry output mass",
      drift: (ctx: ReturnType<typeof makePayloadDriftContext>) => {
        const runs = ctx.runs.map((run) => ({
          ...run,
          biocharDryMassKg: CHANGED_RUN_OUTPUT_MASS_KG,
        }));
        return {
          ...ctx,
          runs,
          batchesWithSamples: ctx.batchesWithSamples.map((batch) => ({
            ...batch,
            runs: batch.runs.map((run) => ({ ...run, biocharDryMassKg: CHANGED_RUN_OUTPUT_MASS_KG })),
          })),
          ...buildMassAccounting(ctx.lineages, runs),
        };
      },
    },
    {
      label: "member production run feedstock mass",
      drift: (ctx: ReturnType<typeof makePayloadDriftContext>) => ({
        ...ctx,
        runs: ctx.runs.map((run) => ({
          ...run,
          feedstockMassDryKg: CHANGED_FEEDSTOCK_MASS_KG,
        })),
      }),
    },
    {
      label: "credit-batch Sample organic carbon chemistry",
      drift: (ctx: ReturnType<typeof makePayloadDriftContext>) => ({
        ...ctx,
        batchesWithSamples: ctx.batchesWithSamples.map((batch) => ({
          ...batch,
          samples: batch.samples.map((sample) => ({
            ...sample,
            organicCarbonPercent: CHANGED_ORGANIC_CARBON_PERCENT,
          })),
        })),
      }),
    },
    {
      label: "reporting-window production start",
      drift: (ctx: ReturnType<typeof makePayloadDriftContext>) => ({
        ...ctx,
        runs: ctx.runs.map((run) => ({
          ...run,
          startTime: new Date(CHANGED_PRODUCTION_START),
        })),
      }),
    },
    {
      label: "reporting-window latest application date",
      drift: (ctx: ReturnType<typeof makePayloadDriftContext>) => ({
        ...ctx,
        lineages: ctx.lineages.map((lineage) => ({
          ...lineage,
          application: {
            ...lineage.application,
            applicationDate: new Date(CHANGED_APPLICATION_DATE),
          },
        })),
      }),
    },
  ])("retires the draft before any POST when $label drifts after context load", async ({ drift }) => {
    const original = makePayloadDriftContext();
    const fresh = drift(original);
    // All lineage IDs, claim state and frozen application masses stay stable.
    // Only the claimed-draft semantic rebuild can detect these edits.
    expect(fresh.memberBatchClaims).toEqual(original.memberBatchClaims);
    expect(fresh.runs.map((run) => run.id)).toEqual([PRODUCTION_RUN_ID]);
    expect(fresh.batchesWithSamples.flatMap((batch) =>
      batch.samples.map((sample) => sample.id),
    )).toEqual(original.batchesWithSamples.flatMap((batch) =>
      batch.samples.map((sample) => sample.id),
    ));
    vi.mocked(certifyContext.loadRemovalSubmissionContext)
      .mockResolvedValueOnce(original)
      .mockImplementation(async () => {
        // The second context read occurs after snapshot insertion, before POST.
        expect(storedRows).toHaveLength(1);
        expect(storedRows[0].status).toBe("draft");
        return fresh;
      });
    const createDatapointFake = vi.fn(fakeExternalIds("dp"));
    const createGhgEntryFake = vi.fn(fakeExternalIds("rmv"));
    vi.mocked(isometric.createDatapoint).mockImplementation(createDatapointFake as never);
    vi.mocked(isometric.createGhgEntry).mockImplementation(createGhgEntryFake as never);

    const attempt = submitRemoval({
      orgCtx: makeTestOrgContext(USER_ID),
      removalId: REMOVAL_ID,
    });
    await expect(attempt).rejects.toThrow(SafeError);
    await expect(attempt).rejects.toThrow(SOURCE_DRIFT_MESSAGE);

    expect(certifyContext.loadRemovalSubmissionContext).toHaveBeenCalledTimes(2);
    expect(storedRows).toHaveLength(1);
    expect(storedRows[0]).toMatchObject({ status: "superseded", lockedAt: null });
    expect(storedRows[0].payloadSnapshot).toMatchObject({
      semantic: {
        startedOn: "2026-01-01T00:00:00.000Z",
        completedOn: "2026-04-05T00:00:00.000Z",
        inputs: expect.arrayContaining([
          expect.objectContaining({ inputKey: "feedstock_mass", value: original.runs[0].feedstockMassDryKg }),
          expect.objectContaining({ inputKey: "carbon_content", value: ORIGINAL_ORGANIC_CARBON_FRACTION }),
        ]),
      },
    });
    expect(ledger.retireStaleSubmissionDraft).toHaveBeenCalledWith(
      makeTestOrgContext(USER_ID),
      storedRows[0].id,
      expect.objectContaining({ reason: expect.stringContaining("semantic payload drift") }),
    );
    expect(createDatapointFake).not.toHaveBeenCalled();
    expect(createGhgEntryFake).not.toHaveBeenCalled();
    expect(ledger.markSubmissionSubmitted).not.toHaveBeenCalled();
    expect(isometricClientFake.post).not.toHaveBeenCalled();
  });
});

describe("submitRemoval — stale-revision resume gate (ADR 0020)", () => {
  it("retires an expired draft built under an older mapping revision, fails closed, and a retry mints a fresh version", async () => {
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
      makeContext(),
    );
    // An interrupted draft from a previous deploy: lock long expired (routes
    // to resume), snapshot stamped with an obsolete INPUT_MAPPING revision.
    const staleRow = newLedgerRow({
      provider: "isometric",
      submissionType: "removal",
      localEntityType: "removal",
      localEntityId: REMOVAL_ID,
      version: 1,
      payloadSnapshot: { __mappingRevision: "rev-obsolete" },
      payloadHash: "hash-from-old-accounting",
      metadata: null,
    });
    staleRow.lockedAt = new Date(0);
    storedRows.push(staleRow);
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
    ).rejects.toThrow(/older calculation settings/);
    // Retired (terminal, non-blocking), nothing POSTed, nothing flipped.
    expect(ledger.retireStaleSubmissionDraft).toHaveBeenCalledWith(
      makeTestOrgContext(USER_ID),
      staleRow.id,
      expect.objectContaining({
        reason: expect.stringContaining("rev-obsolete"),
      }),
    );
    expect(staleRow.status).toBe("superseded");
    expect(createDatapointFake).not.toHaveBeenCalled();
    expect(createGhgEntryFake).not.toHaveBeenCalled();
    expect(ledger.markSubmissionSubmitted).not.toHaveBeenCalled();

    // The retry does NOT resume the retired draft: it mints a fresh version
    // from live data under the current revision (no stuck-forever loop).
    const retried = await submitRemoval({
      orgCtx: makeTestOrgContext(USER_ID),
      removalId: REMOVAL_ID,
    });
    expect(retried.version).toBe(2);
    expect(createGhgEntryFake).toHaveBeenCalledTimes(1);
  });

  it("preserves an interrupted stale-revision draft when registry mutation was confirmed", async () => {
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
      makeContext(),
    );
    const staleRow = newLedgerRow({
      provider: "isometric",
      submissionType: "removal",
      localEntityType: "removal",
      localEntityId: REMOVAL_ID,
      version: 1,
      payloadSnapshot: { __mappingRevision: "rev-obsolete" },
      payloadHash: "hash-from-old-accounting",
      metadata: {
        lastAttemptOutcome: "interrupted",
        externalMutation: "confirmed",
      },
    });
    staleRow.lockedAt = new Date(0);
    storedRows.push(staleRow);
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
    ).rejects.toThrow(/ask support to reconcile/i);

    expect(staleRow.status).toBe("draft");
    expect(staleRow.metadata).toMatchObject({
      lastAttemptOutcome: "interrupted",
      externalMutation: "confirmed",
    });
    expect(ledger.retireStaleSubmissionDraft).not.toHaveBeenCalled();
    expect(ledgerClaim.markSubmissionInterrupted).toHaveBeenCalledWith(
      makeTestOrgContext(USER_ID),
      staleRow.id,
      expect.objectContaining({ externalMutation: "confirmed" }),
    );
    expect(ledger.markSubmissionRejected).not.toHaveBeenCalled();
    expect(createDatapointFake).not.toHaveBeenCalled();
    expect(createGhgEntryFake).not.toHaveBeenCalled();
  });
});
