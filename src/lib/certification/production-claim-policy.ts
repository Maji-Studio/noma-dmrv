export type ProductionClaimContribution =
  | "production-and-delivery"
  | "delivery-only";

export function includesProductionInputs(
  claimedByRemovalId: string | null,
  removalId: string | null,
): boolean {
  return claimedByRemovalId == null || claimedByRemovalId === removalId;
}

export function productionClaimContribution(
  claimedByRemovalId: string | null,
  removalId: string | null,
): ProductionClaimContribution {
  return includesProductionInputs(claimedByRemovalId, removalId)
    ? "production-and-delivery"
    : "delivery-only";
}
