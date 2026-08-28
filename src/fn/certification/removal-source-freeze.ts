import type { CertificationSubmissionRow } from "@/data-access/certification";
import { isLockedInFlight } from "@/lib/isometric/utils/lock";
import type { CandidateSourceDocument } from "./source-candidates";

const SOURCE_FROZEN_SUBMISSION_STATUSES = new Set<
  CertificationSubmissionRow["status"]
>(["submitted", "accepted", "superseded"]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function frozenCandidateDocumentIds(
  submission: CertificationSubmissionRow,
): Set<string> {
  const snapshot = record(submission.payloadSnapshot);
  const semantic = record(snapshot?.semantic);
  const candidates = semantic?.candidateSources;
  if (!Array.isArray(candidates)) return new Set();

  return new Set(
    candidates.flatMap((candidate) => {
      const documentId = record(candidate)?.documentId;
      return typeof documentId === "string" ? [documentId] : [];
    }),
  );
}

/**
 * A claimed or terminal Removal submission freezes its evidence set. New files
 * attached to reachable entities belong to a later workflow; they must not
 * change an idempotent retry or supersede the already-reviewed registry claim.
 */
export function filterCandidateSourcesForSubmissionLifecycle(
  candidates: CandidateSourceDocument[],
  latestSubmission: CertificationSubmissionRow | null,
): CandidateSourceDocument[] {
  if (
    !latestSubmission ||
    (!SOURCE_FROZEN_SUBMISSION_STATUSES.has(latestSubmission.status) &&
      !isLockedInFlight(latestSubmission))
  ) {
    return candidates;
  }

  const frozenDocumentIds = frozenCandidateDocumentIds(latestSubmission);
  return candidates.filter((candidate) =>
    frozenDocumentIds.has(candidate.documentId),
  );
}
