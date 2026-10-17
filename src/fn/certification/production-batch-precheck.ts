import { resolveIsometricClient } from "@/data-access/certifier-credentials";
import {
  getProductionBatchRegistrations,
  getProductionBatchRegistryInputs,
} from "@/data-access/certifier-production-batches";
import type { OrgContext } from "@/lib/auth/server";
import {
  buildProductionBatchReference,
  getProductionBatch,
} from "@/lib/isometric/production-batches";
import type { Logger } from "@/lib/log";
import { assertRegisteredProductionBatchMatches } from "./production-batch-drift";
import {
  buildProductionBatchSubmission,
  matchesLegacyDateBoundPayloadHash,
  type ProductionBatchSubmission,
} from "./production-batches";

/** Stop registered figure drift before any submission registry writes. */
export async function assertRegisteredProductionBatchesMatch(args: {
  orgCtx: OrgContext;
  removalId: string;
  creditBatchIds: string[];
  log: Logger;
}): Promise<void> {
  const creditBatchIds = [...new Set(args.creditBatchIds)];
  if (creditBatchIds.length === 0) return;
  const [inputs, existingRows] = await Promise.all([
    getProductionBatchRegistryInputs(args.orgCtx, creditBatchIds),
    getProductionBatchRegistrations(args.orgCtx, creditBatchIds),
  ]);
  const existingByCreditBatchId = new Map(
    existingRows.map((row) => [row.creditBatchId, row]),
  );
  const client = await resolveIsometricClient(args.orgCtx);
  // Use code-unit order, matching the registration loop regardless of locale.
  for (const input of [...inputs].sort((left, right) =>
    left.creditBatchId < right.creditBatchId ? -1 : left.creditBatchId > right.creditBatchId ? 1 : 0,
  )) {
    const existing = existingByCreditBatchId.get(input.creditBatchId);
    if (!existing) continue;
    const remote = await getProductionBatch(client, existing.externalProductionBatchId);
    // Identity, mapping and recovery failures remain the registration loop's job.
    if (!remote ||
      remote.id !== existing.externalProductionBatchId ||
      remote.supplier_reference_id !== existing.supplierReference ||
      existing.supplierReference !== buildProductionBatchReference({ creditBatchId: input.creditBatchId }) ||
      remote.facility_id !== existing.externalFacilityId
    ) continue;
    let current: ProductionBatchSubmission;
    try {
      current = buildProductionBatchSubmission(input);
    } catch {
      // Leave unbuildable local payloads to the existing reuse behavior.
      continue;
    }
    if (current.payloadHash === existing.payloadHash ||
      matchesLegacyDateBoundPayloadHash(input, current, existing.payloadHash)
    ) continue;
    await assertRegisteredProductionBatchMatches({
      orgCtx: args.orgCtx,
      removalId: args.removalId,
      submission: current,
      remote,
      legacyWindow: input,
      recordSucceededEvent: false,
      log: args.log,
    });
  }
}
