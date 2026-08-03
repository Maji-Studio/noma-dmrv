import type { RemoteGhgStatus } from "./status";

/**
 * Carbon fields read from Isometric (or, for a statement, an exact sum of its
 * readable member GHG Entries). No local sequestration, activity, fallback, or
 * reconciliation fields are representable on this interface.
 */
export interface RegistryCarbonResult {
  netRemovedKg: number;
  netBeforeDiscountKg: number;
  standardDeviationKg: number | null;
  riskOfReversalPercent: number | null;
  bufferCreditsKg: number | null;
  supplierCreditsKg: number | null;
  registryStatementId: string | null;
  registryStatementStatus: RemoteGhgStatus | null;
}
