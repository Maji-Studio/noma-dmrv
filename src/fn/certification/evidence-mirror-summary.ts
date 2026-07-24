import type { OrgContext } from "@/lib/auth/server";
import { loadCandidateDocumentsForRemovalForUser } from "./sources";

export interface EvidenceMirrorSummary {
  total: number;
  mirrored: number;
}

/** Project the Sources panel's candidate set into readiness counts. */
export async function loadEvidenceMirrorSummaryForUser(
  orgCtx: OrgContext,
  removalId: string | null,
): Promise<EvidenceMirrorSummary> {
  if (!removalId) return { total: 0, mirrored: 0 };
  const result = await loadCandidateDocumentsForRemovalForUser(
    orgCtx,
    removalId,
  );
  return {
    total: result.candidates.length,
    mirrored: result.candidates.filter((candidate) => candidate.mirror).length,
  };
}
