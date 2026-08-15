import {
  APPLICATION_ID,
  CHANGED_BIOCHAR_MASS_KG,
  CREDIT_BATCH_ID,
  ORIGINAL_BIOCHAR_MASS_KG,
  PRODUCTION_RUN_ID,
  REMOVAL_ID,
  USER_ID,
  fakeExternalIds,
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
            claimedByRemovalId: "rem-other",
            productionRunIds: [PRODUCTION_RUN_ID],
            applicationIds: [APPLICATION_ID],
            applicationSlices: [],
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
            claimedByRemovalId: REMOVAL_ID,
            productionRunIds: [PRODUCTION_RUN_ID],
            applicationIds: [APPLICATION_ID],
            applicationSlices: [],
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
      .mockResolvedValue(makeContext(CHANGED_BIOCHAR_MASS_KG));
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
