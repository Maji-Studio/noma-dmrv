"use server";

import { getProductionBatchRegistrations } from "@/data-access/certifier-production-batches";
import {
  getCertifierRemovalById,
  getCreditBatchSummariesByRemovalIds,
} from "@/data-access/certifier-removals";
import { SafeError } from "@/lib/errors";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";

// One registered Isometric production batch behind a member credit batch —
// the identity columns of the `certifier_production_batches` journal row,
// labelled with the batch code the operator knows it by.
export interface RemovalProductionBatchLink {
  creditBatchId: string;
  creditBatchCode: string;
  externalProductionBatchId: string;
  supplierReference: string;
}

/**
 * Read-only list of the registered production batches behind one Removal's
 * member credit batches, for the detail sheet's registry deep links. DB-only:
 * the journal row is written on the same confirmation that mints `ptb_…`, so
 * this never needs the Isometric API. Members without a registration (not yet
 * submitted past the production-batch step) are simply absent.
 */
export async function loadRemovalProductionBatches(
  removalId: string,
): Promise<ActionResult<RemovalProductionBatchLink[]>> {
  return withAction(async (orgCtx) => {
    const removal = await getCertifierRemovalById(orgCtx, removalId);
    if (!removal) throw new SafeError("Removal not found.");

    const membersByRemoval = await getCreditBatchSummariesByRemovalIds(orgCtx, [
      removalId,
    ]);
    const members = membersByRemoval.get(removalId) ?? [];
    if (members.length === 0) return [];

    const registrations = await getProductionBatchRegistrations(
      orgCtx,
      members.map((member) => member.id),
    );
    const codeByCreditBatchId = new Map(
      members.map((member) => [member.id, member.code]),
    );

    return registrations
      .map((row) => ({
        creditBatchId: row.creditBatchId,
        creditBatchCode:
          codeByCreditBatchId.get(row.creditBatchId) ?? row.creditBatchId,
        externalProductionBatchId: row.externalProductionBatchId,
        supplierReference: row.supplierReference,
      }))
      .sort((left, right) =>
        left.creditBatchCode < right.creditBatchCode
          ? -1
          : left.creditBatchCode > right.creditBatchCode
            ? 1
            : 0,
      );
  });
}
