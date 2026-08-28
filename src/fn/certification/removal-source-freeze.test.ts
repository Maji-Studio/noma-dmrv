import { describe, expect, it } from "vitest";
import type { CertificationSubmissionRow } from "@/data-access/certification";
import { SafeError } from "@/lib/errors";
import type { CandidateSourceDocument } from "./source-candidates";
import { filterCandidateSourcesForSubmissionLifecycle } from "./removal-source-freeze";

const frozenOperatorCandidate: CandidateSourceDocument = {
  documentId: "frozen-document",
  binding: null,
  biocharApplicationId: "frozen-biochar-application",
};
const currentCandidates: CandidateSourceDocument[] = [
  {
    documentId: "frozen-document",
    binding: null,
    biocharApplicationId: "reclassified-biochar-application",
  },
  {
    documentId: "new-application-photo",
    binding: null,
    biocharApplicationId: "new-biochar-application",
  },
  {
    documentId: "current-transport-ledger",
    binding: {
      nomaRole: "transport_evidence_ledger",
      nomaRoleLabel: "Transport evidence ledger",
      lineage: {
        entityType: "credit_batch",
        entityId: "batch-1",
        entityLabel: "Credit batch CB-1",
      },
      intendedTarget: {
        kind: "ordinary",
        groupKey: "biochar-transport",
        componentBlueprintKey: "mass_distance_based_ci_emissions",
        inputKey: "mass_distance",
        optionalInTemplate: true,
      },
      mappingRevision: "source-bindings-v1",
    },
    biocharApplicationId: null,
  },
];

function submission(
  overrides: Partial<CertificationSubmissionRow> = {},
): CertificationSubmissionRow {
  return {
    status: "submitted",
    metadata: {},
    payloadSnapshot: {
      semantic: { candidateSources: [frozenOperatorCandidate] },
    },
    ...overrides,
  } as CertificationSubmissionRow;
}

describe("Removal Source freeze", () => {
  it.each([null, "rejected", "superseded"] as const)(
    "keeps the live candidate set when latest status is %s",
    (status) => {
      expect(
        filterCandidateSourcesForSubmissionLifecycle(
          currentCandidates,
          status === null ? null : submission({ status }),
        ),
      ).toEqual(currentCandidates);
    },
  );

  it.each([
    { lockedAt: null },
    { lockedAt: new Date() },
  ])("reuses the exact frozen tuple for every draft retry", (draftState) => {
    expect(
      filterCandidateSourcesForSubmissionLifecycle(
        currentCandidates,
        submission({ status: "draft", ...draftState }),
      ),
    ).toEqual([frozenOperatorCandidate]);
  });

  it.each(["submitted", "accepted"] as const)(
    "freezes operator evidence but admits the current generated ledger for %s",
    (status) => {
      expect(
        filterCandidateSourcesForSubmissionLifecycle(
          currentCandidates,
          submission({ status }),
        ),
      ).toEqual([frozenOperatorCandidate, currentCandidates[2]]);
    },
  );

  it("retains frozen operator evidence when live discovery no longer returns it", () => {
    expect(
      filterCandidateSourcesForSubmissionLifecycle(
        currentCandidates.slice(1),
        submission(),
      ),
    ).toEqual([frozenOperatorCandidate, currentCandidates[2]]);
  });

  it("fails closed when a frozen snapshot has no candidate evidence set", () => {
    expect(() =>
      filterCandidateSourcesForSubmissionLifecycle(
        currentCandidates,
        submission({ payloadSnapshot: {} }),
      ),
    ).toThrow(SafeError);
  });
});
