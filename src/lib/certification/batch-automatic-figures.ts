import type { AutomaticSourceId } from "@/lib/isometric/template-observations/catalog-sources";
import { sumFigures, type BatchEmissionLineFacts, type EmissionFigure } from "./emission-lines";
import { multiplyEntryDecimals } from "./emission-entry-rules";
import { ROUND_TRIP_DISTANCE_FACTOR } from "@/lib/calculations/round-trip";
import { transportMassDistanceAvailable, type ProductionRunForCertification, type TransportLegsByCategory } from "@/lib/isometric/utils/aggregation";

function sourceForCategory(category: "feedstock" | "biochar" | "sample") {
  return category === "biochar" ? "delivery-transport" : (`${category}-transport` as const);
}
const SOURCE_UNITS: Record<AutomaticSourceId, string> = {
  "run-genset-diesel": "L", "run-startup-diesel": "L", "run-electricity": "kWh",
  "feedstock-dry-mass": "kg", "biochar-dry-mass": "kg", "safety-margin": "kg",
  "feedstock-transport": "km * tonne", "delivery-transport": "km * tonne",
  "sample-transport": "km * tonne", sequestration: "kg",
};
const KG_TO_TONNES = "0.001";
const RUN_SOURCE_FIELDS = {
  "run-genset-diesel": ["dieselGensetLiters", "preprocessingFuelLiters"],
  "run-startup-diesel": ["dieselOperationLiters"], "run-electricity": ["electricityKwh"],
  "feedstock-dry-mass": ["feedstockMassDryKg"], "biochar-dry-mass": ["biocharDryMassKg"],
  "safety-margin": ["biocharDryMassKg"],
} as const;
export interface ExactEmissionMasses {
  runs: Record<string, { feedstockMassDryKg: string | null; biocharDryMassKg: string | null }>;
  legs: Record<string, string | null>;
}
/** Same presence and transport guards as submission. Sum decimal text, never floats.
 * Energy and distances originate in real columns; stringify those once at the boundary.
 */
export function batchAutomaticFigures(runs: ProductionRunForCertification[], legs: TransportLegsByCategory, exact?: ExactEmissionMasses): BatchEmissionLineFacts["automaticFigures"] {
  const figures: BatchEmissionLineFacts["automaticFigures"] = { sequestration: null };
  for (const [source, fields] of Object.entries(RUN_SOURCE_FIELDS)) {
    const unit = SOURCE_UNITS[source as keyof typeof RUN_SOURCE_FIELDS];
    const values = runs.flatMap((run) => fields.flatMap((field) => {
      const mass = field === "feedstockMassDryKg" || field === "biocharDryMassKg";
      const value = mass && exact ? exact.runs[run.id]?.[field] : run[field];
      return value == null ? [] : [{ magnitude: String(value), unit }];
    }));
    figures[source as keyof typeof RUN_SOURCE_FIELDS] = sumFigures(values);
  }
  for (const category of ["feedstock", "biochar", "sample"] as const) {
    const categoryLegs = legs[category];
    const valid = transportMassDistanceAvailable(categoryLegs, category === "biochar");
    if (!valid) {
      figures[sourceForCategory(category)] = null;
      continue;
    }
    const source = sourceForCategory(category);
    const values: EmissionFigure[] = categoryLegs.map((leg) => {
      // Biochar legs are projections of allocated delivery loads, not persisted legs.
      const mass = exact && Object.hasOwn(exact.legs, leg.id) ? exact.legs[leg.id] : leg.loadMassKg;
      return {
        magnitude: multiplyEntryDecimals(multiplyEntryDecimals(String(mass ?? 0), KG_TO_TONNES), multiplyEntryDecimals(String(leg.distanceKm), String(ROUND_TRIP_DISTANCE_FACTOR))),
        unit: SOURCE_UNITS[source],
      };
    });
    figures[source] = sumFigures(values);
  }
  return figures;
}

