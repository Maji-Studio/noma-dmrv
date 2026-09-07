"use server";

import { z } from "zod";
import { requireOrgRole } from "@/lib/auth/server";
import { requestRemovalEvidenceRefresh } from "@/data-access/removal-evidence-refresh";
import { getCertifierRemovalById } from "@/data-access/certifier-removals";
import { withFacilityDurabilitySessionLock } from "@/data-access/facility-durability-lock";
import { getIsometricClientForOrg, reconcileRemoval } from "@/lib/isometric";
import { SafeError } from "@/lib/errors";
import { withAction } from "../with-action";
import { loadCandidateDocumentsForRemovalForUser } from "./source-candidates";
import { readRemovalCandidateSources, readRemovalTransport } from "./removal-snapshot-readers";

const refreshSchema = z.object({ removalId: z.uuid(), submissionId: z.uuid() });

/** Start a reviewed version without changing any historic payload or registry resource. */
export async function refreshInterruptedRemovalEvidence(input: unknown) {
  return withAction(async (ctx) => {
    requireOrgRole(ctx, "admin");
    const parsed = refreshSchema.parse(input);
    const removal = await getCertifierRemovalById(ctx, parsed.removalId);
    if (!removal) throw new SafeError("Removal not found.");
    return withFacilityDurabilitySessionLock(ctx, removal.facilityId, () =>
      requestRemovalEvidenceRefresh(ctx, parsed, async (submission) => {
        const client = await getIsometricClientForOrg(ctx.organizationId);
        const remote = await reconcileRemoval(client, {
          supplierRefId: readRemovalTransport(submission).removalSupplierRef,
        });
        if (remote.found) {
          throw new SafeError("This attempt already has a registry GHG Entry. Retry its saved evidence first. New evidence requires a reviewed registry amendment.");
        }
        const frozen = readRemovalCandidateSources(submission);
        const frozenIds = new Set(frozen.map((candidate) => candidate.documentId));
        const live = await loadCandidateDocumentsForRemovalForUser(ctx, removal.id);
        const additions = live.candidates.filter((candidate) =>
          candidate.biocharApplicationId && !candidate.binding && !frozenIds.has(candidate.document.id),
        ).map((candidate) => ({ documentId: candidate.document.id, binding: null, biocharApplicationId: candidate.biocharApplicationId }));
        if (additions.length === 0) throw new SafeError("No new Application evidence is available. Retry the saved attempt.");
        return [...frozen, ...additions];
      }),
    );
  });
}
