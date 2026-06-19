import { getDeliveriesByIds } from "@/data-access/deliveries";
import { getFeedstocksByIds } from "@/data-access/feedstocks";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import { deriveEntityCertifyReadiness } from "@/lib/certification/entity-readiness";
import { collectTransportEntityIds } from "@/lib/isometric";
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

function uniqueIds(ids: (string | null | undefined)[]): string[] {
  return Array.from(new Set(ids.filter((id): id is string => !!id)));
}

function formatReadinessGapLabels(
  entityLabel: string,
  readinessGaps: ReturnType<typeof deriveEntityCertifyReadiness>["gaps"],
): string[] {
  if (readinessGaps.length === 0) return [];
  return [
    `${entityLabel}: ${readinessGaps.map((gap) => gap.label).join(" · ")}`,
  ];
}

/**
 * Truck-weighing readiness gaps for feedstock intake (when feedstock transport is
 * required) and biochar delivery (when biochar transport is required). Reads the
 * feedstock / delivery rows only for the categories the template actually needs.
 */
export async function buildTransportSourceReadinessGaps(
  userId: string,
  lineages: ChainOfCustodyData[],
  entityIds: ReturnType<typeof collectTransportEntityIds>,
  requiredTransportCategories: readonly TransportCategory[],
): Promise<string[]> {
  const requireFeedstockWeighing =
    requiredTransportCategories.includes("feedstock");
  const requireDeliveryWeighing =
    requiredTransportCategories.includes("biochar");
  const feedstockIds = requireFeedstockWeighing ? entityIds.feedstockIds : [];
  const deliveryIds = requireDeliveryWeighing
    ? uniqueIds(lineages.map((lineage) => lineage.delivery?.id))
    : [];

  const [feedstockRows, deliveryRows] = await Promise.all([
    feedstockIds.length > 0
      ? getFeedstocksByIds(userId, feedstockIds)
      : Promise.resolve([]),
    deliveryIds.length > 0
      ? getDeliveriesByIds(userId, deliveryIds)
      : Promise.resolve([]),
  ]);

  const gaps = [
    ...(feedstockRows ?? []).flatMap((feedstock) =>
      formatReadinessGapLabels(
        `Feedstock ${feedstock.code}`,
        deriveEntityCertifyReadiness("feedstock", {
          ...feedstock,
          requiresTruckWeighing: true,
        }).gaps.filter((gap) => gap.key === "truckWeighing"),
      ),
    ),
    ...(deliveryRows ?? []).flatMap((delivery) =>
      formatReadinessGapLabels(
        `Delivery ${delivery.code}`,
        deriveEntityCertifyReadiness("delivery", {
          ...delivery,
          requiresTruckWeighing: true,
        }).gaps.filter((gap) => gap.key === "truckWeighing"),
      ),
    ),
  ];

  return Array.from(new Set(gaps));
}
