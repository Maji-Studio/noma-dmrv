import { getMetadataValue, SUBMISSION_METADATA_KEYS } from "@/lib/certification/submission-metadata";
import type { CertificationSubmissionRow } from "@/data-access/certification";
import type { NomaEvidenceRole } from "@/lib/certification/removal-source-bindings";
import { readRemovalCandidateSources } from "./removal-snapshot-readers";
import type { CandidateSourceDocument } from "./source-candidates";

const FROZEN_SNAPSHOT_STATUSES = new Set(["draft", "submitted", "accepted"]);

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

function isEntryEvidence(candidate: CandidateSourceDocument): boolean {
  return candidate.binding?.nomaRole === "emission_entry";
}

function followsCurrentManifest(candidate: CandidateSourceDocument): boolean {
  return isGeneratedEvidence(candidate) || isEntryEvidence(candidate);
}

/**
 * A blocking Removal submission freezes its operator evidence tuple, not just
 * document IDs. Draft retries preserve reviewed operator uploads and ledgers.
 * A terminal claim may use freshly generated ledgers. Entry files always follow
 * the current contribution manifest, which applies the frozen or live entry set
 * for the attempt. Superseded/rejected attempts rebuild live.
 */
export function filterCandidateSourcesForSubmissionLifecycle(
  candidates: CandidateSourceDocument[],
  latestSubmission: CertificationSubmissionRow | null,
  correctionWindowOpen = false,
): CandidateSourceDocument[] {
  if (
    correctionWindowOpen ||
    !latestSubmission ||
    !FROZEN_SNAPSHOT_STATUSES.has(latestSubmission.status)
  ) {
    return candidates;
  }

  const frozenCandidates = readRemovalCandidateSources(latestSubmission);
  if (latestSubmission.status === "draft") {
    const refreshed = getMetadataValue(latestSubmission.metadata, SUBMISSION_METADATA_KEYS.evidenceRefreshCandidates);
    if (!refreshed) return [
      ...frozenCandidates.filter((candidate) => !isEntryEvidence(candidate)),
      ...candidates.filter((candidate) => isEntryEvidence(candidate)),
    ];
    const reviewed = readRemovalCandidateSources({ ...latestSubmission, payloadSnapshot: { semantic: { candidateSources: refreshed } } });
    return [
      ...reviewed.filter((candidate) => !followsCurrentManifest(candidate)),
      ...candidates.filter((candidate) => followsCurrentManifest(candidate)),
    ];
  }

  const currentManifestCandidates = candidates.filter((candidate) => followsCurrentManifest(candidate));
  const frozenOperatorCandidates = frozenCandidates.filter(
    (candidate) => !followsCurrentManifest(candidate),
  );
  return Array.from(
    new Map(
      [...frozenOperatorCandidates, ...currentManifestCandidates].map(
        (candidate) => [candidate.documentId, candidate],
      ),
    ).values(),
  );
}
