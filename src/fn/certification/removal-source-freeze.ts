import { getMetadataValue, SUBMISSION_METADATA_KEYS } from "@/lib/certification/submission-metadata";
import type { CertificationSubmissionRow } from "@/data-access/certification";
import type { NomaEvidenceRole } from "@/lib/certification/removal-source-bindings";
import {
  BLOCKING_SUBMISSION_STATUSES,
  type LocalSubmissionStatus,
} from "@/lib/certification/status";
import type { OrgContext } from "@/lib/auth/server";
import type { RemovalSubmissionContext } from "./certify-context-core";
import { readRemovalCandidateSources } from "./removal-snapshot-readers";
import {
  collectCandidateSourceDocumentsForRemoval,
  type CandidateSourceDocument,
} from "./source-candidates";

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
  if (latestSubmission.status === "draft") {
    const refreshed = getMetadataValue(latestSubmission.metadata, SUBMISSION_METADATA_KEYS.evidenceRefreshCandidates);
    if (!refreshed) return frozenCandidates;
    const reviewed = readRemovalCandidateSources({ ...latestSubmission, payloadSnapshot: { semantic: { candidateSources: refreshed } } });
    return [
      ...reviewed.filter((candidate) => !isGeneratedEvidence(candidate)),
      ...candidates.filter(isGeneratedEvidence),
    ];
  }

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

/** The slice of the submission context that decides a Removal's Source candidates. */
export type SubmissionSourceCandidateContext = Pick<
  RemovalSubmissionContext,
  "lineages" | "memberBatches" | "batchesWithSamples" | "latestSubmission"
>;

/**
 * The Source candidates a Removal submission owns: documents reachable from the
 * submission context's live lineage, passed through the lifecycle freeze
 * above. Evidence planning and the submission mirror both derive candidates
 * here, so the mirror never trusts a candidate tuple handed to it.
 */
export async function collectSubmissionSourceCandidates(
  orgCtx: OrgContext,
  removalId: string,
  ctx: SubmissionSourceCandidateContext,
): Promise<CandidateSourceDocument[]> {
  return filterCandidateSourcesForSubmissionLifecycle(
    await collectCandidateSourceDocumentsForRemoval(orgCtx, {
      removalId,
      lineages: ctx.lineages,
      memberBatches: ctx.memberBatches,
      memberSamples: ctx.batchesWithSamples.flatMap((batch) =>
        batch.samples.map((sample) => ({
          id: sample.id,
          code: sample.sampleCode,
        })),
      ),
    }),
    ctx.latestSubmission,
  );
}
