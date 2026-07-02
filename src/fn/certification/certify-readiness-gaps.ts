import { deriveEntityCertifyReadiness } from "@/lib/certification/entity-readiness";
import type { ProductionRunWithSamples } from "@/lib/isometric/utils/aggregation";
import type { CreditBatchWithSamples } from "@/data-access/credit-batch-samples";
import type { TransportCategory } from "./certify-context-core";
import type { TransportLegsByCategory } from "./shared";

// Per-entity certify-readiness gap derivation, factored out of
// `certify-context-core` to keep that orchestrator under the line cap. These
// build the compact gap labels the Review / pre-flight surfaces show; the raw
// entity rows stay server-side.

/**
 * Compact per-entity readiness-gap labels for the removal's production runs,
 * the member batches' pooled lab samples (issue #309: samples anchor on the
 * credit batch, whose declared durability tier they inherit), and the required
 * transport legs.
 */
export function buildEntityReadinessGaps(
  runs: ProductionRunWithSamples[],
  batchesWithSamples: CreditBatchWithSamples[],
  transportLegs: TransportLegsByCategory,
  requiredTransportCategories: readonly TransportCategory[],
): string[] {
  const gaps: string[] = [];
  const addEntityGaps = (
    entityLabel: string,
    readinessGaps: ReturnType<typeof deriveEntityCertifyReadiness>["gaps"],
  ) => {
    if (readinessGaps.length === 0) return;
    gaps.push(
      `${entityLabel}: ${readinessGaps.map((gap) => gap.label).join(" · ")}`,
    );
  };

  for (const run of runs) {
    addEntityGaps(
      `Production run ${run.code}`,
      deriveEntityCertifyReadiness("productionRun", run).gaps,
    );
  }

  for (const batch of batchesWithSamples) {
    for (const sample of batch.samples) {
      addEntityGaps(
        `Sample ${sample.sampleCode}`,
        deriveEntityCertifyReadiness("sample", {
          ...sample,
          durabilityOption: batch.durabilityOption,
        }).gaps,
      );
    }
  }

  for (const category of requiredTransportCategories) {
    const legs = transportLegs[category];
    for (const leg of legs) {
      addEntityGaps(
        `${category} transport leg ${leg.id}`,
        deriveEntityCertifyReadiness("transportLeg", leg).gaps,
      );
    }
  }

  return Array.from(new Set(gaps));
}
