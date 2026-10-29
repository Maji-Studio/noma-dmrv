import { missingFeedstockTransportIds } from "@/lib/certification/submission-readiness";
import { aggregateBiocharTransportMassDistance, transportVehicleAdvisories } from "@/lib/isometric/utils/aggregation";
import {
  aggregateTransportMassDistance,
  collectTransportEntityIds,
  type IsometricGhgEntryTemplate,
} from "@/lib/isometric";
import { TRANSPORT_CATEGORIES } from "@/lib/isometric/semantic-binding-catalog";
import {
  lookupBindingTriple,
  projectTransportCategories,
  type TransportCategoryTable,
} from "@/lib/isometric/semantic-binding-projections";
import type { TransportLegsByCategory } from "./shared";

export interface TransportCoverageBucket {
  count: number;
  ownedElsewhere?: boolean;
  entityIds: string[];
  legIds: string[];
  firstLegEntityId: string | null;
  // Non-null when at least one leg fails the per-leg uniformity or completeness
  // checks. Pooling several batches raises the chance of a mixed method/mode,
  // so the panel surfaces the warning before submission.
  aggregationWarning: string | null;
  vehicleAdvisories: string[];
  missingEntityIds?: string[];
}

export interface TransportCoverage {
  feedstock: TransportCoverageBucket;
  biochar: TransportCoverageBucket;
  sample: TransportCoverageBucket;
}

export type TransportCategory = keyof TransportCoverage;

// (group, blueprint, input) → transport category, projected from the
// semantic binding catalog.
const TRANSPORT_CATEGORY_TUPLES: TransportCategoryTable =
  projectTransportCategories();

export function deriveRequiredTransportCategories(
  template: IsometricGhgEntryTemplate,
  categoryTuples: TransportCategoryTable = TRANSPORT_CATEGORY_TUPLES,
): TransportCategory[] {
  const seen = new Set<TransportCategory>();
  for (const group of template.groups) {
    for (const component of group.components) {
      for (const rtcInput of component.inputs) {
        if (rtcInput.type !== "monitored") continue;
        const category = lookupBindingTriple(
          categoryTuples,
          group.key,
          component.blueprint_key,
          rtcInput.input_key,
        );
        if (category) seen.add(category);
      }
    }
  }
  return TRANSPORT_CATEGORIES.filter((category) => seen.has(category) && category !== "sample");
}

export function buildTransportCoverage(
  legs: TransportLegsByCategory,
  entityIds: ReturnType<typeof collectTransportEntityIds> & { linkedFeedstockIds?: string[] },
  feedstockPresenceLegs: Parameters<typeof missingFeedstockTransportIds>[1] = legs.feedstock,
): TransportCoverage {
  return {
    feedstock: {
      ownedElsewhere: entityIds.feedstockTransportOwnedElsewhere,
      missingEntityIds: missingFeedstockTransportIds(entityIds.linkedFeedstockIds ?? entityIds.feedstockIds, feedstockPresenceLegs),
      vehicleAdvisories: transportVehicleAdvisories(legs.feedstock, "Feedstock"),
      count: legs.feedstock.length,
      entityIds: entityIds.feedstockIds,
      legIds: legs.feedstock.map((leg) => leg.id),
      firstLegEntityId: legs.feedstock[0]?.entityId ?? null,
      aggregationWarning: aggregateTransportMassDistance(
        legs.feedstock,
        "Feedstock",
      ).warning,
    },
    biochar: {
      vehicleAdvisories: transportVehicleAdvisories(legs.biochar, "Biochar"),
      count: legs.biochar.length,
      entityIds: entityIds.biocharProductIds,
      legIds: legs.biochar.map((leg) => leg.id),
      firstLegEntityId: legs.biochar[0]?.entityId ?? null,
      aggregationWarning: aggregateBiocharTransportMassDistance(legs.biochar).warning,
    },
    sample: {
      vehicleAdvisories: [],
      count: 0,
      entityIds: [],
      legIds: [],
      firstLegEntityId: null,
      aggregationWarning: null,
    },
  };
}

export const EMPTY_TRANSPORT_COVERAGE: TransportCoverage = {
  feedstock: {
    count: 0,
    entityIds: [],
    legIds: [],
    firstLegEntityId: null,
    aggregationWarning: null,
    vehicleAdvisories: [],
  },
  biochar: {
    count: 0,
    entityIds: [],
    legIds: [],
    firstLegEntityId: null,
    aggregationWarning: null,
    vehicleAdvisories: [],
  },
  sample: {
    count: 0,
    entityIds: [],
    legIds: [],
    firstLegEntityId: null,
    aggregationWarning: null,
    vehicleAdvisories: [],
  },
};
