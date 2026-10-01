import {
  aggregateTransportMassDistance,
  collectTransportEntityIds,
  type IsometricGhgEntryTemplate,
} from "@/lib/isometric";
import {
  lookupBindingTriple,
  projectTransportCategories,
  TRANSPORT_CATEGORIES,
  type TransportCategoryTable,
} from "@/lib/isometric/semantic-binding-catalog";
import type { TransportLegsByCategory } from "./shared";

export interface TransportCoverageBucket {
  count: number;
  entityIds: string[];
  legIds: string[];
  firstLegEntityId: string | null;
  // Non-null when at least one leg fails the per-leg uniformity or completeness
  // checks. Pooling several batches raises the chance of a mixed method/factor,
  // so the panel surfaces the warning before submission.
  aggregationWarning: string | null;
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
  return TRANSPORT_CATEGORIES.filter((category) => seen.has(category));
}

export function buildTransportCoverage(
  legs: TransportLegsByCategory,
  entityIds: ReturnType<typeof collectTransportEntityIds>,
): TransportCoverage {
  return {
    feedstock: {
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
      count: legs.biochar.length,
      entityIds: entityIds.biocharProductIds,
      legIds: legs.biochar.map((leg) => leg.id),
      firstLegEntityId: legs.biochar[0]?.entityId ?? null,
      aggregationWarning: aggregateTransportMassDistance(
        legs.biochar,
        "Biochar",
      ).warning,
    },
    sample: {
      count: legs.sample.length,
      entityIds: entityIds.sampleIds,
      legIds: legs.sample.map((leg) => leg.id),
      firstLegEntityId: legs.sample[0]?.entityId ?? null,
      aggregationWarning: aggregateTransportMassDistance(
        legs.sample,
        "Sample",
      ).warning,
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
  },
  biochar: {
    count: 0,
    entityIds: [],
    legIds: [],
    firstLegEntityId: null,
    aggregationWarning: null,
  },
  sample: {
    count: 0,
    entityIds: [],
    legIds: [],
    firstLegEntityId: null,
    aggregationWarning: null,
  },
};
