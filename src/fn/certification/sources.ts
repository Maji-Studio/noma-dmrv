"use server";

import {
  canRefreshSubmissionEvidence,
  getMetadataValue,
  isSubmissionAttemptInterrupted,
  SUBMISSION_METADATA_KEYS,
} from "@/lib/certification/submission-metadata";
import { getLatestSubmission } from "@/data-access/certification-submissions";
import {
  loadCandidateDocumentsForRemovalSchema,
  mirrorDocumentToSourceSchema,
} from "@/schemas/certification-sources";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";
import {
  ISOMETRIC_PROVIDER,
  REMOVAL_ENTITY_TYPE,
  REMOVAL_SUBMISSION_TYPE,
} from "./shared";
import {
  loadCandidateDocumentsForRemovalForUser,
  type CandidateDocumentsForRemoval,
} from "./source-candidates";
import {
  mirrorDocumentToSourceForUser,
  type MirrorResult,
} from "./sources-mirror-core";
import { filterCandidateSourcesForSubmissionLifecycle } from "./removal-source-freeze";

// Session-authenticated Source actions. Every export here is a public Server
// Action; trusted-context helpers live in `./source-candidates` and
// `./sources-mirror-core`, which have no directive.

export async function loadCandidateDocumentsForRemoval(
  input: unknown,
): Promise<ActionResult<CandidateDocumentsForRemoval>> {
  return withAction(async (orgCtx) => {
    const parsed = loadCandidateDocumentsForRemovalSchema.parse(input);
    const [data, latest] = await Promise.all([
      loadCandidateDocumentsForRemovalForUser(orgCtx, parsed.removalId),
      getLatestSubmission(orgCtx, { provider: ISOMETRIC_PROVIDER, submissionType: REMOVAL_SUBMISSION_TYPE, localEntityType: REMOVAL_ENTITY_TYPE, localEntityId: parsed.removalId }),
    ]);
    const selected = filterCandidateSourcesForSubmissionLifecycle(
      data.candidates.map((candidate) => ({
        documentId: candidate.document.id,
        binding: candidate.binding,
        biocharApplicationId: candidate.biocharApplicationId,
      })),
      latest,
    );
    const selectedById = new Map(selected.map((candidate) => [candidate.documentId, candidate]));
    const canReviewEvidence = latest?.status === "draft" &&
      !latest.externalId && isSubmissionAttemptInterrupted(latest.metadata) && canRefreshSubmissionEvidence(latest.metadata) &&
      !getMetadataValue(latest.metadata, SUBMISSION_METADATA_KEYS.evidenceRefreshCandidates) &&
      data.candidates.some((candidate) => candidate.biocharApplicationId && !candidate.binding && !selectedById.has(candidate.document.id));
    return {
      ...data,
      evidenceRefreshSubmissionId: canReviewEvidence ? latest.id : null,
      candidates: data.candidates.map((candidate) => {
        const frozen = selectedById.get(candidate.document.id);
        const includedInSubmission = !!frozen &&
          (frozen.biocharApplicationId ?? null) === (candidate.biocharApplicationId ?? null);
        return { ...candidate, includedInSubmission };
      }),
    };
  });
}

// Source mutations are anchored to a specific removal so the server can verify
// the document actually belongs to that removal's lineage; the core re-derives
// the candidate and enforces the Removal lifecycle.
export async function mirrorDocumentToSource(
  input: unknown,
): Promise<ActionResult<MirrorResult>> {
  return withAction((orgCtx) =>
    mirrorDocumentToSourceForUser(
      orgCtx,
      mirrorDocumentToSourceSchema.parse(input),
    ),
  );
}

export type { MirrorResult } from "./sources-mirror-core";
export type {
  CandidateDocument,
  CandidateDocumentsForRemoval,
  CandidateLineageEntity,
  CandidateSourceDocument,
  ResolvedSourceBindingCandidate,
} from "./source-candidates";

// Re-export the input types for caller convenience.
export type {
  MirrorDocumentToSourceInput,
  LoadCandidateDocumentsForRemovalInput,
} from "@/schemas/certification-sources";
