/**
 * Pre-submit readiness and supporting-Source gates for `submitRemoval`.
 *
 * Kept separate from the transport/happy-path orchestrator suite so each file
 * stays below the repository's 1000-line review cap.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeTestOrgContext } from "./helpers/test-org";
import {
  ORIGINAL_BIOCHAR_MASS_KG,
  REMOVAL_ID,
  USER_ID,
  fakeExternalIds,
  makeContext,
  makeInventorySourceDocument,
  makeResolvedInventorySource,
  storedRows,
} from "./fixtures/submit-removal-orchestrator";
import * as ledger from "@/data-access/certification";
import * as certifyContext from "@/fn/certification/certify-context-core";
import * as evidenceLedgers from "@/fn/certification/ensure-evidence-ledgers";
import * as sources from "@/fn/certification/sources";
import { submitRemoval } from "@/fn/certification/submit-removal";
import { compileRemovalSubmission } from "@/fn/certification/removal-submission-build";
import * as isometric from "@/lib/isometric";
import { reviewPayloadHash } from "@/lib/certification/removal-review-hash";
import * as sourceVerification from "@/lib/isometric/source-binding-verification";

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

function attemptSummaryEvents() {
  return vi
    .mocked(ledger.appendSyncEvent)
    .mock.calls.filter(
      ([, input]) => input.operation === "removal:submit:attempt-summary",
    );
}

describe("submitRemoval — entity readiness gate", () => {
  it("blocks before submit-phase side effects", async () => {
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
      makeContext(ORIGINAL_BIOCHAR_MASS_KG, {
        entityReadinessGaps: [
          "Application APP-TEST-001: Upload the application logbook",
        ],
      }),
    );

    await expect(
      submitRemoval({
        orgCtx: makeTestOrgContext(USER_ID),
        removalId: REMOVAL_ID,
      }),
    ).rejects.toThrow(/entity certification readiness/i);

    expect(
      evidenceLedgers.ensureEvidenceLedgersFromContext,
    ).not.toHaveBeenCalled();
    expect(isometric.getIsometricClientForOrg).not.toHaveBeenCalled();
    expect(storedRows).toHaveLength(0);
    expect(attemptSummaryEvents()).toHaveLength(1);
    expect(attemptSummaryEvents()[0]?.[1]).toMatchObject({
      status: "failed",
      attemptedAt: expect.any(Date),
      responsePayload: {
        attempt_id: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        ),
        outcome: "refused",
        error_class: "SafeError",
        error_message: expect.stringMatching(
          /entity certification readiness/i,
        ),
        ghg_entry_external_mutation: "none",
      },
    });
  });

  it("blocks durability gaps before generating evidence ledgers", async () => {
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
      makeContext(ORIGINAL_BIOCHAR_MASS_KG, {
        durabilityGateBlockers: [
          "Credit batch CB-TEST-001 has 2 replicate(s); at least 3 are required.",
        ],
      }),
    );

    await expect(
      submitRemoval({
        orgCtx: makeTestOrgContext(USER_ID),
        removalId: REMOVAL_ID,
      }),
    ).rejects.toThrow(/sampling & eligibility/i);

    expect(
      evidenceLedgers.ensureEvidenceLedgersFromContext,
    ).not.toHaveBeenCalled();
    expect(storedRows).toHaveLength(0);
  });

  it("fails when the required attempt-summary audit cannot be persisted", async () => {
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
      makeContext(ORIGINAL_BIOCHAR_MASS_KG, {
        entityReadinessGaps: ["Application evidence is missing."],
      }),
    );
    vi.mocked(ledger.appendSyncEvent).mockRejectedValueOnce(
      new Error("audit store unavailable"),
    );

    await expect(
      submitRemoval({
        orgCtx: makeTestOrgContext(USER_ID),
        removalId: REMOVAL_ID,
      }),
    ).rejects.toThrow(/audit store unavailable/i);

    expect(ledger.appendSyncEvent).toHaveBeenCalledTimes(1);
  });
});

describe("submitRemoval — Source binding gate", () => {
  it("preserves the reviewed hash while pending Source IDs materialize", async () => {
    const ctx = makeContext();
    const candidates = ["doc-1", "doc-2"].map(makeInventorySourceDocument);
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
      ctx,
    );
    vi.mocked(
      sources.collectCandidateSourceDocumentsForRemoval,
    ).mockResolvedValue(candidates);

    let prepared = false;
    vi.mocked(sources.resolveSourceBindingCandidates).mockImplementation(
      async (_ctx, { candidates: currentCandidates }) =>
        prepared
          ? currentCandidates.map((candidate, index) =>
              makeResolvedInventorySource(
                candidate.documentId,
                `src-${index + 1}`,
              ),
            )
          : [],
    );
    vi.mocked(
      sources.mirrorCandidateSourcesForSubmission,
    ).mockImplementation(async () => {
      prepared = true;
    });

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
      allowPendingSources: true,
    });
    expect(reviewed.snapshot).not.toBeNull();
    const reviewedHash = reviewPayloadHash(
      reviewed.snapshot!.semanticPayload,
    );

    vi.mocked(isometric.createDatapoint).mockImplementation(
      fakeExternalIds("dtp") as never,
    );
    vi.mocked(isometric.createGhgEntry).mockImplementation(
      fakeExternalIds("rem") as never,
    );

    await expect(
      submitRemoval({
        orgCtx: makeTestOrgContext(USER_ID),
        removalId: REMOVAL_ID,
        expectedCompilationHash: reviewedHash,
      }),
    ).resolves.toMatchObject({ externalId: "rem_1" });

    expect(
      sources.mirrorCandidateSourcesForSubmission,
    ).toHaveBeenCalledWith(
      expect.any(Object),
      {
        removalId: REMOVAL_ID,
        candidateDocumentIds: ["doc-1", "doc-2"],
      },
    );
    const submittedSemantic = (
      storedRows[0].payloadSnapshot as {
        semantic: Record<string, unknown>;
      }
    ).semantic;
    expect(reviewPayloadHash(submittedSemantic)).toBe(reviewedHash);
  });

  it.each([
    {
      label: "no mirrored Source",
      candidates: ["doc-1"],
      sourceIds: [] as string[],
      expected: /Only 0 of 1 supporting files/i,
    },
    {
      label: "partially mirrored Sources",
      candidates: ["doc-1", "doc-2"],
      sourceIds: ["src-1"],
      expected: /Only 1 of 2 supporting files/i,
    },
  ])("fails closed for $label before claim or POST", async ({
    candidates,
    sourceIds,
    expected,
  }) => {
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
      makeContext(),
    );
    vi.mocked(
      sources.collectCandidateSourceDocumentsForRemoval,
    ).mockResolvedValue(candidates.map(makeInventorySourceDocument));
    vi.mocked(sources.resolveSourceBindingCandidates).mockResolvedValue(
      sourceIds.map((sourceId, index) =>
        makeResolvedInventorySource(candidates[index]!, sourceId),
      ),
    );

    await expect(
      submitRemoval({
        orgCtx: makeTestOrgContext(USER_ID),
        removalId: REMOVAL_ID,
      }),
    ).rejects.toThrow(expected);

    expect(storedRows).toHaveLength(0);
    expect(
      evidenceLedgers.ensureEvidenceLedgersFromContext,
    ).not.toHaveBeenCalled();
    expect(isometric.createDatapoint).not.toHaveBeenCalled();
    expect(isometric.createGhgEntry).not.toHaveBeenCalled();
    expect(attemptSummaryEvents()).toHaveLength(1);
    expect(attemptSummaryEvents()[0]?.[1]).toMatchObject({
      responsePayload: {
        outcome: "refused",
        ghg_entry_external_mutation: "none",
      },
    });
  });

  it("recompiles and refuses a Source set that becomes partial under mirror locks", async () => {
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
      makeContext(),
    );
    vi.mocked(
      sources.collectCandidateSourceDocumentsForRemoval,
    ).mockResolvedValue(
      ["doc-1", "doc-2"].map(makeInventorySourceDocument),
    );
    vi.mocked(sources.resolveSourceBindingCandidates)
      .mockResolvedValueOnce([
        makeResolvedInventorySource("doc-1", "src-1"),
        makeResolvedInventorySource("doc-2", "src-2"),
      ])
      .mockResolvedValueOnce([
        makeResolvedInventorySource("doc-1", "src-1"),
      ]);

    await expect(
      submitRemoval({
        orgCtx: makeTestOrgContext(USER_ID),
        removalId: REMOVAL_ID,
      }),
    ).rejects.toThrow(/Only 1 of 2 supporting files/i);

    expect(storedRows).toHaveLength(0);
    expect(isometric.createDatapoint).not.toHaveBeenCalled();
    expect(isometric.createGhgEntry).not.toHaveBeenCalled();
  });
});
