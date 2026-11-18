import type { OrgContext } from "@/lib/auth/server";
import { getSentRemovalForComparison } from "@/data-access/removal-entry-correction";
import { generatedEvidenceFacts, generatedEvidenceFactsSchema, compareGeneratedEvidenceFacts } from "./generated-evidence-facts";
import type { RemovalSubmissionContext } from "./certify-context-types";

/** Only the immutable sent snapshot is authoritative; active documents may be newer. */
export async function changedGeneratedEvidence(ctx: OrgContext, removalId: string, context: RemovalSubmissionContext) {
  const sent = await getSentRemovalForComparison(ctx, removalId);
  const snapshot = sent?.payloadSnapshot;
  const baseline = snapshot && typeof snapshot === "object" && "generatedEvidenceFacts" in snapshot
    ? snapshot.generatedEvidenceFacts : undefined;
  if (!generatedEvidenceFactsSchema.safeParse(baseline).success) return [];
  return compareGeneratedEvidenceFacts(generatedEvidenceFacts(context), baseline).changed;
}
