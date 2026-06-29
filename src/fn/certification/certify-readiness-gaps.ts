import { deriveEntityCertifyReadiness } from "@/lib/certification/entity-readiness";
import type { ProductionRunWithSamples } from "@/lib/isometric/utils/aggregation";
import type { TransportCategory } from "./certify-context-core";
import type { TransportLegsByCategory } from "./shared";

// Per-entity certify-readiness gap derivation, factored out of
// `certify-context-core` to keep that orchestrator under the line cap. These
// build the compact gap labels the Review / pre-flight surfaces show; the raw
// entity rows stay server-side.

type DurabilityOption = "200_year" | "1000_year";

/**
 * Compact per-entity readiness-gap labels for the removal's production runs, their
 * samples (durability option picked per run), and the required transport legs.
 */
export function buildEntityReadinessGaps(
  runs: ProductionRunWithSamples[],
  transportLegs: TransportLegsByCategory,
  requiredTransportCategories: readonly TransportCategory[],
  runIdsRequiring1000YearDurability: ReadonlySet<string>,
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
    for (const sample of run.samples) {
      const durabilityOption: DurabilityOption =
        runIdsRequiring1000YearDurability.has(run.id)
          ? "1000_year"
          : "200_year";
      addEntityGaps(
        `Sample ${sample.sampleCode}`,
        deriveEntityCertifyReadiness("sample", {
          ...sample,
          durabilityOption,
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
