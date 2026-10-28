import { requireOrgFacility } from "@/data-access/utils";
import type { OrgContext } from "@/lib/auth/server";
import { getCreditBatchById } from "@/data-access/credit-batches";
import { SafeError } from "@/lib/errors";
import { loadBatchesEmissionLines, type BatchEmissionLinesResult } from "./batches-emission-lines";

/** Batch display facts only. A stored observation never authorizes submission. */
export async function loadBatchEmissionLines(ctx: OrgContext, facilityId: string, creditBatchId: string): Promise<BatchEmissionLinesResult> {
  await requireOrgFacility(ctx, facilityId);
  const batch = await getCreditBatchById(ctx, creditBatchId, { skipPreview: true });
  if (!batch || batch.facilityId !== facilityId) throw new SafeError("Credit batch was not found.");
  const results = await loadBatchesEmissionLines(ctx, [batch], { comments: true });
  return results.get(batch.id)!;
}
