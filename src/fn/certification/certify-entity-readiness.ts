import type { CreditBatchWithSamples } from "@/data-access/credit-batch-samples";
import type { ProductionRunWithSamples } from "@/lib/isometric/utils/aggregation";
import type { TransportCategory } from "./certify-context-core";
import type { TransportLegsByCategory } from "./shared";
import { buildEntityReadinessResult } from "./certify-readiness-gaps";

/**
 * Builds submission readiness for facts required by the active Removal
 * integration. Application evidence is retained for verification and PDD
 * support, but is not a Removal-submission requirement under protocol v1.1.
 */
export function buildCertifyEntityReadiness(args: {
  runs: ProductionRunWithSamples[];
  batchesWithSamples: CreditBatchWithSamples[];
  transportLegs: TransportLegsByCategory;
  requiredTransportCategories: readonly TransportCategory[];
}) {
  const entityReadiness = buildEntityReadinessResult(
    args.runs,
    args.batchesWithSamples,
    args.transportLegs,
    args.requiredTransportCategories,
  );

  return {
    gaps: entityReadiness.gaps,
    warnings: entityReadiness.warnings,
    issues: entityReadiness.issues,
  };
}
