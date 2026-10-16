import { sumFigures, type BatchEmissionLineFacts, type EmissionFigure } from "./emission-lines";
import { multiplyEntryDecimals } from "./emission-entry-rules";
import { ROUND_TRIP_DISTANCE_FACTOR } from "@/lib/calculations/round-trip";
import type { ProductionRunForCertification, TransportLegsByCategory } from "@/lib/isometric/utils/aggregation";

function sourceForCategory(category: "feedstock" | "biochar" | "sample") {
  return category === "biochar" ? "delivery-transport" : (`${category}-transport` as const);
}
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
    const unit = source === "run-electricity" ? "kWh" : source.startsWith("run-") ? "L" : "kg";
    const values = runs.flatMap((run) => fields.flatMap((field) => {
      const mass = field === "feedstockMassDryKg" || field === "biocharDryMassKg";
      const value = mass && exact ? exact.runs[run.id]?.[field] : run[field];
      return value == null ? [] : [{ magnitude: String(value), unit }];
    }));
    figures[source as keyof typeof RUN_SOURCE_FIELDS] = sumFigures(values);
  }
  for (const category of ["feedstock", "biochar", "sample"] as const) {
    const categoryLegs = legs[category];
    // Match aggregateTransportMassDistance / aggregateBiocharTransportMassDistance
    // presence and factor gates without running their floating-point sums.
    const first = categoryLegs[0];
    const valid = first && categoryLegs.every((leg) =>
      leg.loadMassKg != null && Number.isFinite(leg.loadMassKg) && leg.loadMassKg > 0 &&
      leg.calculationMethodType === first.calculationMethodType && leg.transportMethodType === first.transportMethodType &&
      (category !== "biochar" || (Number.isFinite(leg.distanceKm) && leg.distanceKm > 0)),
    );
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
        unit: "km * tonne",
      };
    });
    figures[source] = sumFigures(values);
  }
  return figures;
}

