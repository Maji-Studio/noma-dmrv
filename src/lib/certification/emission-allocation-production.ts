import type { EmissionAllocationFacts } from "./emission-allocation-facts";

/** Permanent claims and protected reservations outrank the submit gate's ordered attempts. */
export function allocationProductionOwner(facts: EmissionAllocationFacts, batchId: string | null) {
  if (!batchId) return { removalId: null, pending: false };
  const claimed = facts.productionClaims?.[batchId];
  if (claimed) return { removalId: claimed, pending: false };
  if (Object.hasOwn(facts.productionReservations ?? {}, batchId)) {
    return { removalId: facts.productionReservations![batchId], pending: true };
  }
  const active = facts.productionContenders?.find(contender => contender.creditBatchId === batchId);
  if (active) return { removalId: active.removalId, pending: true };
  // Before claimSubmissionDraft there is no attempt to order. A sole unsent Removal
  // (a draft, or a rejection with no registry ID that can be retried) is
  // unambiguous; several do not yet have a submit-gate winner.
  const drafts = facts.removals.filter(removal => (removal.canSendProduction ?? removal.status === "draft") &&
    removal.creditBatchIds.includes(batchId));
  return { removalId: drafts.length === 1 ? drafts[0].id : null, pending: true };
}
