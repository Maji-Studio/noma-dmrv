import type { OrgContext } from "@/lib/auth/server";
import type { IsometricGhgEntryTemplate } from "@/lib/isometric";
import { buildRemovalSourceBindingPlan } from "@/lib/certification/removal-source-bindings";
import {
  attachSourcesToBiocharApplicationIntents,
  type BiocharApplicationIntent,
} from "./biochar-application-intents";
import type { RemovalSubmissionContext } from "./certify-context-core";
import { filterCandidateSourcesForSubmissionLifecycle } from "./removal-source-freeze";
import {
  collectCandidateSourceDocumentsForRemoval,
  resolveSourceBindingCandidates,
  type CandidateSourceDocument,
  type ResolvedSourceBindingCandidate,
} from "./sources";

type BoundCandidate<T extends { binding: unknown }> = T & {
  binding: NonNullable<T["binding"]>;
};

const hasBinding = <T extends { binding: unknown }>(
  candidate: T,
): candidate is BoundCandidate<T> => candidate.binding !== null;

const sortedUnique = (values: string[]) => Array.from(new Set(values)).sort();

/** Evidence a caller already owns, so the plan neither walks nor resolves it again. */
export interface SuppliedRemovalEvidence {
  sourceIds?: string[];
  candidateDocumentIds?: string[];
  sourceBindingCandidates?: ResolvedSourceBindingCandidate[];
  candidateSourceDocuments?: CandidateSourceDocument[];
}

/** Which applications, samples and deliveries each member credit batch owns. */
function readBatchMembership(ctx: RemovalSubmissionContext) {
  // Delivery bills of lading target batch-scoped transport inputs.
  const deliveryIdByApplicationId = new Map(
    ctx.lineages.map((lineage) => [
      lineage.application.id,
      lineage.delivery.id,
    ]),
  );
  return {
    applicationIdsByCreditBatchId: new Map(
      ctx.memberBatchClaims.map((batch) => [
        batch.creditBatchId,
        batch.applicationIds,
      ]),
    ),
    sampleIdsByCreditBatchId: new Map(
      ctx.batchesWithSamples.map((batch) => [
        batch.creditBatchId,
        batch.samples.map((sample) => sample.id),
      ]),
    ),
    deliveryIdsByCreditBatchId: new Map(
      ctx.memberBatchClaims.map((batch) => [
        batch.creditBatchId,
        Array.from(
          new Set(
            batch.applicationIds.flatMap((applicationId) => {
              const deliveryId = deliveryIdByApplicationId.get(applicationId);
              return deliveryId ? [deliveryId] : [];
            }),
          ),
        ),
      ]),
    ),
  };
}

/**
 * Reads a Removal's evidence once and projects it three ways: the operational
 * binding plan (transport-ready Sources only), the semantic plan (pending
 * files included, for the payload hash) and the Sources on each Biochar
 * Application intent.
 */
export async function planRemovalEvidence(args: {
  orgCtx: OrgContext;
  removalId: string;
  ctx: RemovalSubmissionContext;
  template: IsometricGhgEntryTemplate;
  compiledBiocharApplicationIntents: BiocharApplicationIntent[];
  supplied: SuppliedRemovalEvidence;
}) {
  const { orgCtx, removalId, ctx, template, supplied } = args;

  // A caller-supplied Source set makes this a side-effect-free preflight or a
  // locked rebuild. Skip the document walk in that case; the caller already
  // owns the authoritative IDs and does not consume `candidateDocumentIds`.
  const candidateSourceDocuments =
    supplied.candidateSourceDocuments ??
    (supplied.sourceIds || supplied.sourceBindingCandidates
      ? []
      : filterCandidateSourcesForSubmissionLifecycle(
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
        ));
  const sourceBindingCandidates =
    supplied.sourceBindingCandidates ??
    (supplied.sourceIds
      ? []
      : await resolveSourceBindingCandidates(orgCtx, {
          candidates: candidateSourceDocuments,
        }));
  const datapointSourceCandidates = sourceBindingCandidates.filter(hasBinding);

  const sourceIdByDocumentId = new Map(
    sourceBindingCandidates.map((candidate) => [
      candidate.documentId,
      candidate.sourceId,
    ]),
  );
  const membership = readBatchMembership(ctx);

  return {
    candidateSourceDocuments,
    candidateDocumentIds:
      supplied.candidateDocumentIds ??
      sortedUnique(
        candidateSourceDocuments.map((candidate) => candidate.documentId),
      ),
    readySourceDocumentCount: sourceBindingCandidates.length,
    sourceIds:
      supplied.sourceIds ??
      sortedUnique(sourceBindingCandidates.map((candidate) => candidate.sourceId)),
    datapointSourceIds:
      supplied.sourceIds ??
      sortedUnique(
        datapointSourceCandidates.map((candidate) => candidate.sourceId),
      ),
    biocharApplicationIntents: attachSourcesToBiocharApplicationIntents(
      args.compiledBiocharApplicationIntents,
      sourceBindingCandidates,
    ),
    sourceBindingPlan: buildRemovalSourceBindingPlan({
      candidates: datapointSourceCandidates,
      template,
      ...membership,
    }),
    // The semantic plan includes pending files with placeholder Source IDs. The
    // operational plan above remains strict, so placeholders never reach the API.
    semanticSourceBindingPlan: buildRemovalSourceBindingPlan({
      candidates: candidateSourceDocuments
        .filter(hasBinding)
        .map((candidate) => ({
          ...candidate,
          sourceId: sourceIdByDocumentId.get(candidate.documentId) ?? "",
        })),
      template,
      ...membership,
    }),
  };
}
