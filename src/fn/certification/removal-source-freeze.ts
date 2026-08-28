import type { CertificationSubmissionRow } from "@/data-access/certification";
import type { NomaEvidenceRole } from "@/lib/certification/removal-source-bindings";
import {
  BLOCKING_SUBMISSION_STATUSES,
  type LocalSubmissionStatus,
} from "@/lib/certification/status";
import { readRemovalCandidateSources } from "./removal-snapshot-readers";
import type { CandidateSourceDocument } from "./source-candidates";

const SOURCE_FROZEN_SUBMISSION_STATUSES = new Set<LocalSubmissionStatus>(
  BLOCKING_SUBMISSION_STATUSES,
);
const GENERATED_EVIDENCE_ROLES = new Set<NomaEvidenceRole>([
  "transport_evidence_ledger",
  "durability_evidence_ledger",
]);

function isGeneratedEvidence(candidate: CandidateSourceDocument): boolean {
  return (
    candidate.binding !== null &&
    GENERATED_EVIDENCE_ROLES.has(candidate.binding.nomaRole)
  );
}

/**
 * A blocking Removal submission freezes its operator evidence tuple, not just
 * document IDs. Draft retries are exact. A terminal claim may be superseded
 * with freshly generated deterministic ledgers, while operator uploads remain
 * fixed to the reviewed snapshot. Superseded/rejected attempts rebuild live.
 */
export function filterCandidateSourcesForSubmissionLifecycle(
  candidates: CandidateSourceDocument[],
  latestSubmission: CertificationSubmissionRow | null,
): CandidateSourceDocument[] {
  if (
    !latestSubmission ||
    !SOURCE_FROZEN_SUBMISSION_STATUSES.has(latestSubmission.status)
  ) {
    return candidates;
  }

  const frozenCandidates = readRemovalCandidateSources(latestSubmission);
  if (latestSubmission.status === "draft") return frozenCandidates;

  const currentGeneratedCandidates = candidates.filter(isGeneratedEvidence);
  const frozenOperatorCandidates = frozenCandidates.filter(
    (candidate) => !isGeneratedEvidence(candidate),
  );
  return Array.from(
    new Map(
      [...frozenOperatorCandidates, ...currentGeneratedCandidates].map(
        (candidate) => [candidate.documentId, candidate],
      ),
    ).values(),
  );
}
