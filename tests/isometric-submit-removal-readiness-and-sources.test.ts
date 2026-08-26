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
import * as biocharApplications from "@/fn/certification/biochar-applications";
import * as biocharApplicationsDA from "@/data-access/certifier-biochar-applications";
import * as sources from "@/fn/certification/sources";
import { submitRemoval } from "@/fn/certification/submit-removal";
import { compileRemovalSubmission } from "@/fn/certification/removal-submission-build";
import * as isometric from "@/lib/isometric";
import { reviewPayloadHash } from "@/lib/certification/removal-review-hash";
import { classifyRemovalSourceCandidate } from "@/lib/certification/removal-source-bindings";
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
  it("preflights every Biochar Application before any registry or claim mutation", async () => {
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
      makeContext(),
    );
    vi.mocked(
      biocharApplicationsDA.getBiocharApplicationRegistryInputs,
    ).mockResolvedValueOnce([
      {
        applicationId: "app-test-1",
        applicationCode: "APP-TEST-001",
        applicationDate: new Date("2026-04-05T00:00:00Z"),
        appliedTonnes: 1,
        fieldSizeHa: null,
        deliveryId: "del-1",
        deliveryCode: "DEL-TEST-001",
        deliveredWetMassKg: 1_000,
        facilityId: "fac-test-1",
        certifierProjectId: "cert-proj-1",
        externalProjectId: "prj_test_1",
        customerLocationId: "00000000-0000-4000-8000-000000000099",
        customerLocationName: "Test field",
        latitude: 46.948,
        longitude: 7.447,
      },
    ]);

    await expect(
      submitRemoval({
        orgCtx: makeTestOrgContext(USER_ID),
        removalId: REMOVAL_ID,
      }),
    ).rejects.toThrow(/field size greater than 0 ha/i);

    expect(storedRows).toHaveLength(0);
    expect(isometric.createDatapoint).not.toHaveBeenCalled();
    expect(isometric.createGhgEntry).not.toHaveBeenCalled();
    expect(
      biocharApplications.ensureRemovalBiocharApplications,
    ).not.toHaveBeenCalled();
  });

  it("blocks an unmapped pyrolysis feedstock before submit side effects", async () => {
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
      makeContext(ORIGINAL_BIOCHAR_MASS_KG, {
        feedstockTypeMappingGaps: [
          {
            creditBatchId: "batch-1",
            creditBatchCode: "CB-TEST-001",
            feedstockTypeId: "feedstock-type-1",
            feedstockTypeName: "Macadamia shells",
          },
        ],
      }),
    );

    await expect(
      submitRemoval({
        orgCtx: makeTestOrgContext(USER_ID),
        removalId: REMOVAL_ID,
      }),
    ).rejects.toThrow(/Macadamia shells.*not linked to an Isometric feedstock type/i);

    expect(
      evidenceLedgers.ensureEvidenceLedgersFromContext,
    ).not.toHaveBeenCalled();
    expect(isometric.getIsometricClientForOrg).not.toHaveBeenCalled();
    expect(storedRows).toHaveLength(0);
  });

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
    ).rejects.toThrow(/Complete these fields before submitting the Removal/i);

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
          /Complete these fields before submitting the Removal/i,
        ),
        ghg_entry_external_mutation: "none",
      },
    });
  });

  it("blocks durability gaps before generating evidence ledgers", async () => {
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
      makeContext(ORIGINAL_BIOCHAR_MASS_KG, {
        durabilityGateBlockers: [
          "Credit batch CB-TEST-001 has 2 replicates. Record at least 3.",
        ],
      }),
    );

    await expect(
      submitRemoval({
        orgCtx: makeTestOrgContext(USER_ID),
        removalId: REMOVAL_ID,
      }),
    ).rejects.toThrow(/Sample and eligibility issues/i);

    expect(
      evidenceLedgers.ensureEvidenceLedgersFromContext,
    ).not.toHaveBeenCalled();
    expect(storedRows).toHaveLength(0);
  });

  it("surfaces the submission error when the attempt-summary audit also fails", async () => {
    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
      makeContext(ORIGINAL_BIOCHAR_MASS_KG, {
        entityReadinessGaps: ["Application evidence is missing."],
      }),
    );
    vi.mocked(ledger.appendSyncEvent).mockRejectedValueOnce(
      new Error("audit store unavailable"),
    );

    // The attempt summary is best-effort: a dead audit store must not mask
    // the error the operator can actually act on.
    await expect(
      submitRemoval({
        orgCtx: makeTestOrgContext(USER_ID),
        removalId: REMOVAL_ID,
      }),
    ).rejects.toThrow(/Application evidence is missing/i);

    expect(ledger.appendSyncEvent).toHaveBeenCalledTimes(1);
  });
});

describe("submitRemoval — Source binding gate", () => {
  it("compiles when GIS boundary evidence has no current GHG input target", async () => {
    const ctx = makeContext(ORIGINAL_BIOCHAR_MASS_KG, {
      supportingDocuments: { total: 0, mirrored: 0 },
    });
    const gisBinding = classifyRemovalSourceCandidate({
      documentType: "gis_boundary",
      metadata: { logbookEvidenceType: "inventory" },
      lineage: {
        entityType: "application",
        entityId: ctx.lineages[0]!.application.id,
        entityLabel: `Application ${ctx.lineages[0]!.application.code}`,
      },
    });
    expect(gisBinding).toBeNull();

    vi.mocked(
      sources.collectCandidateSourceDocumentsForRemoval,
    ).mockResolvedValue([]);
    vi.mocked(sources.resolveSourceBindingCandidates).mockResolvedValue([]);

    const compiled = await compileRemovalSubmission({
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

    expect(compiled.blockers).toEqual([]);
    expect(compiled.snapshot).not.toBeNull();
    expect(compiled.transportPlan).toMatchObject({
      candidateDocumentIds: [],
      sourceIds: [],
      sourceBindingPlan: [],
    });
  });

  it("submits with the generated durability ledger and no Application logbook", async () => {
    const ctx = makeContext(ORIGINAL_BIOCHAR_MASS_KG, {
      supportingDocuments: { total: 0, mirrored: 0 },
    });
    const durabilityBinding = classifyRemovalSourceCandidate({
      documentType: "pdf",
      metadata: {
        kind: "durability_evidence_ledger",
        removalId: REMOVAL_ID,
        durabilityOption: "200_year",
      },
      lineage: {
        entityType: "credit_batch",
        entityId: ctx.memberBatches[0]!.id,
        entityLabel: `Credit batch ${ctx.memberBatches[0]!.code}`,
      },
      removalId: REMOVAL_ID,
    });
    expect(durabilityBinding).not.toBeNull();
    let generatedLedgerReady = false;

    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
      ctx,
    );
    vi.mocked(
      evidenceLedgers.ensureEvidenceLedgersFromContext,
    ).mockImplementation(async () => {
      generatedLedgerReady = true;
    });
    vi.mocked(
      sources.collectCandidateSourceDocumentsForRemoval,
    ).mockImplementation(async () =>
      generatedLedgerReady
        ? [
            {
              documentId: "doc-durability-ledger",
              binding: durabilityBinding!,
            },
          ]
        : [],
    );
    vi.mocked(sources.resolveSourceBindingCandidates).mockImplementation(
      async (_ctx, { candidates }) =>
        candidates.map((candidate) => ({
          ...candidate,
          sourceId: "src-durability-ledger",
        })),
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
      }),
    ).resolves.toMatchObject({ externalId: "rem_1" });

    expect(
      evidenceLedgers.ensureEvidenceLedgersFromContext,
    ).toHaveBeenCalledOnce();
    expect(
      (
        storedRows[0].payloadSnapshot as {
          semantic: {
            candidateSources: Array<{ binding: { nomaRole: string } }>;
          };
        }
      ).semantic.candidateSources,
    ).toEqual([
      expect.objectContaining({
        binding: expect.objectContaining({
          nomaRole: "durability_evidence_ledger",
        }),
      }),
    ]);
  });

  it("materializes generated evidence ledgers before compiling the candidate Source set", async () => {
    const ctx = makeContext();
    const inventory = makeInventorySourceDocument("doc-inventory");
    const transportLedger = makeInventorySourceDocument(
      "doc-transport-ledger",
    );
    const durabilityLedger = makeInventorySourceDocument(
      "doc-durability-ledger",
    );
    let generatedLedgersReady = false;

    vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
      ctx,
    );
    vi.mocked(
      evidenceLedgers.ensureEvidenceLedgersFromContext,
    ).mockImplementation(async () => {
      generatedLedgersReady = true;
    });
    vi.mocked(
      sources.collectCandidateSourceDocumentsForRemoval,
    ).mockImplementation(async () =>
      generatedLedgersReady
        ? [inventory, transportLedger, durabilityLedger]
        : [inventory],
    );
    vi.mocked(sources.resolveSourceBindingCandidates).mockImplementation(
      async (_ctx, { candidates }) =>
        candidates.map((candidate) =>
          makeResolvedInventorySource(
            candidate.documentId,
            `src-${candidate.documentId}`,
          ),
        ),
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
      }),
    ).resolves.toMatchObject({ externalId: "rem_1" });

    expect(
      evidenceLedgers.ensureEvidenceLedgersFromContext,
    ).toHaveBeenCalledOnce();
    expect(
      vi.mocked(evidenceLedgers.ensureEvidenceLedgersFromContext).mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(sources.collectCandidateSourceDocumentsForRemoval).mock
        .invocationCallOrder[0],
    );
    expect(
      (
        storedRows[0].payloadSnapshot as {
          semantic: {
            candidateSources: Array<{ documentId: string }>;
          };
        }
      ).semantic.candidateSources.map((candidate) => candidate.documentId),
    ).toEqual([
      "doc-durability-ledger",
      "doc-inventory",
      "doc-transport-ledger",
    ]);
  });

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
    ).toHaveBeenCalledOnce();
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
