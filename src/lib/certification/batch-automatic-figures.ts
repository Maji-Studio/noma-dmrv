import type { BatchEmissionLineFacts, EmissionFigure } from "./emission-lines";
import { AUTOMATIC_SOURCE_IDS, automaticSourceFact, type AutomaticSourceId } from "@/lib/isometric/template-observations/catalog-sources";
import { aggregateProductionRuns, aggregateTransportMassDistance, aggregateBiocharTransportMassDistance, type ProductionRunForCertification, type TransportLegsByCategory } from "@/lib/isometric/utils/aggregation";

const SOURCE_UNITS: Record<AutomaticSourceId, string> = {
  "run-genset-diesel": "L", "run-startup-diesel": "L", "run-electricity": "kWh",
  "feedstock-transport": "tonne * km", "delivery-transport": "tonne * km", "sample-transport": "tonne * km",
  "feedstock-dry-mass": "kg", "biochar-dry-mass": "kg", "safety-margin": "kg", sequestration: "%",
};
const RUN_SOURCE_FIELDS = {
  "run-genset-diesel": ["dieselGensetLiters", "preprocessingFuelLiters"],
  "run-startup-diesel": ["dieselOperationLiters"], "run-electricity": ["electricityKwh"],
  "feedstock-dry-mass": ["feedstockMassDryKg"], "biochar-dry-mass": ["biocharDryMassKg"],
  "safety-margin": ["biocharDryMassKg"],
} as const;

/** Existing registry aggregation, without application scaling or production claims.
 * Presence is checked separately because that aggregator defaults missing energy to zero.
 */
export function batchAutomaticFigures(runs: ProductionRunForCertification[], legs: TransportLegsByCategory): BatchEmissionLineFacts["automaticFigures"] {
  const aggregate = runs.length ? aggregateProductionRuns(runs) : null;
  const transports = {
    feedstockTransportMassDistanceTonneKm: aggregateTransportMassDistance(legs.feedstock, "Feedstock").massDistanceTonneKm,
    biocharTransportMassDistanceTonneKm: aggregateBiocharTransportMassDistance(legs.biochar).massDistanceTonneKm,
    sampleTransportMassDistanceTonneKm: aggregateTransportMassDistance(legs.sample, "Sample").massDistanceTonneKm,
  };
  const figures: Partial<Record<AutomaticSourceId, EmissionFigure | null>> = {};
  for (const source of AUTOMATIC_SOURCE_IDS) {
    const fact = automaticSourceFact(source);
    const fields = source in RUN_SOURCE_FIELDS ? RUN_SOURCE_FIELDS[source as keyof typeof RUN_SOURCE_FIELDS] : null;
    const recorded = fields ? runs.some((run) => fields.some((field) => run[field] != null)) : true;
    // Sequestration is a set of Sample/application inputs, not one batch scalar.
    const value = source === "sequestration" ? null : fact in transports
      ? transports[fact as keyof typeof transports] : aggregate?.[fact as keyof typeof aggregate];
    figures[source] = recorded && typeof value === "number" ? { magnitude: String(value), unit: SOURCE_UNITS[source] } : null;
  }
  return figures;
}

