import { describe, expect, it } from "vitest";
import type { CertificationSubmissionRow } from "@/data-access/certification";
import type { CandidateSourceDocument } from "./source-candidates";
import { filterCandidateSourcesForSubmissionLifecycle } from "./removal-source-freeze";

const candidates = [
  { documentId: "frozen-document" },
  { documentId: "new-application-photo" },
] as CandidateSourceDocument[];

function submission(
  overrides: Partial<CertificationSubmissionRow> = {},
): CertificationSubmissionRow {
  return {
    status: "submitted",
    metadata: {},
    payloadSnapshot: {
      semantic: {
        candidateSources: [{ documentId: "frozen-document" }],
      },
    },
    ...overrides,
  } as CertificationSubmissionRow;
}

describe("Removal Source freeze", () => {
  it("keeps the current candidate set before a submission is claimed", () => {
    expect(
      filterCandidateSourcesForSubmissionLifecycle(candidates, null),
    ).toEqual(candidates);
    expect(
      filterCandidateSourcesForSubmissionLifecycle(
        candidates,
        submission({ status: "draft", metadata: {} }),
      ),
    ).toEqual(candidates);
  });

  it("reuses only the frozen evidence set for terminal submissions", () => {
    expect(
      filterCandidateSourcesForSubmissionLifecycle(
        candidates,
        submission(),
      ).map((candidate) => candidate.documentId),
    ).toEqual(["frozen-document"]);
  });

  it("reuses the frozen set for an in-flight draft retry", () => {
    expect(
      filterCandidateSourcesForSubmissionLifecycle(
        candidates,
        submission({
          status: "draft",
          lockedAt: new Date(),
        }),
      ).map((candidate) => candidate.documentId),
    ).toEqual(["frozen-document"]);
  });

  it("fails closed when a frozen snapshot has no candidate evidence set", () => {
    expect(
      filterCandidateSourcesForSubmissionLifecycle(
        candidates,
        submission({ payloadSnapshot: {} }),
      ),
    ).toEqual([]);
  });
});
