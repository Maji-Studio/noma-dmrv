import type { OrgContext } from "@/lib/auth/server";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import type { CreditBatchWithSamples } from "@/data-access/credit-batch-samples";
import type { ProductionRunWithSamples } from "@/lib/isometric/utils/aggregation";
import type { TransportCategory } from "./certify-context-core";
import type { TransportLegsByCategory } from "./shared";
import { buildApplicationEvidenceReadiness } from "./application-evidence-readiness";
import { buildEntityReadinessResult } from "./certify-readiness-gaps";

/**
 * Builds both the submission gate's flat gap list and the UI's actionable,
 * single-destination issue groups from the same entity walk.
 */
export async function buildCertifyEntityReadiness(args: {
  orgCtx: OrgContext;
  lineages: ChainOfCustodyData[];
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
  const applicationReadiness = await buildApplicationEvidenceReadiness(
    args.orgCtx,
    args.lineages,
  );

  return {
    gaps: [...entityReadiness.gaps, ...applicationReadiness.gaps],
    warnings: entityReadiness.warnings,
    issues: [...entityReadiness.issues, ...applicationReadiness.issues],
  };
}
