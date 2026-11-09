import { getCertifierRemovalById } from "@/data-access/certifier-removals";
import { requireOrgFacility } from "@/data-access/utils";
import { SafeError } from "@/lib/errors";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";
import { buildCreditBatchContexts, loadCertifyContextForCreditBatchForUser, loadRemovalSubmissionContext, projectUiContext } from "@/lib/certification/certify-context-core";
import { loadFacilityCertifierFacts } from "@/lib/certification/facility-certifier-facts";
import type { RemovalCertifyContext } from "@/lib/certification/certify-context-types";
import { buildSelectableBatchesData, type SelectableBatchesData } from "@/lib/certification/selectable-batches";

// Guided Review UI context keyed by removal id; its pre-flight runs the shared
// `deriveRemovalReadiness` classifier against it). Mirrors
// `loadCertifyContextForCreditBatch` but resolves the scope from the removal.
export async function loadRemovalCertifyContext(
  facilityId: string,
  removalId: string,
): Promise<ActionResult<RemovalCertifyContext>> {
  return withAction(async (orgCtx) => {
    await requireOrgFacility(orgCtx, facilityId);
    const removal = await getCertifierRemovalById(orgCtx, removalId);
    if (!removal || removal.facilityId !== facilityId) {
      throw new SafeError("Removal does not belong to requested facility");
    }
    return projectUiContext(
      await loadRemovalSubmissionContext(orgCtx, removalId),
    );
  });
}

export async function loadCertifyContextForCreditBatch(
  creditBatchId: string,
): Promise<ActionResult<RemovalCertifyContext>> {
  return withAction(async (orgCtx) =>
    loadCertifyContextForCreditBatchForUser(orgCtx, creditBatchId),
  );
}
// New-Removal selection payload. Each ungrouped batch carries the same health
// verdict used by credit-batch detail.
export async function loadSelectableBatchesForFacility(
  facilityId: string,
): Promise<ActionResult<SelectableBatchesData>> {
  return withAction(async (orgCtx) => {
    await requireOrgFacility(orgCtx, facilityId);
    const facilityFacts = await loadFacilityCertifierFacts(orgCtx, facilityId);
    return buildSelectableBatchesData(
      orgCtx,
      facilityId,
      facilityFacts,
      buildCreditBatchContexts,
    );
  });
}

