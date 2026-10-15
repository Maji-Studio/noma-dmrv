/**
 * Pure builder: removal transport legs → Evidence Ledger view model.
 *
 * No I/O, no clock reads (generatedAtIso is injected). Per-leg t·km is rounded
 * for display only; category subtotals use the canonical raw-sum transport
 * aggregator, rounded only at the subtotal.
 *
 * Reconciliation contract: each category's `subtotalTkm` equals the scalar
 * submitted to the registry. Feedstock/sample (PRODUCTION bucket) submit the
 * raw leg-sum. Biochar rows carry the Removal's immutable application wet
 * mass per delivery, so no global applied-share scaling is needed.
 */
import { SafeError } from "@/lib/errors";
import type { TransportLeg } from "@/db/schema";
import { kgToTonnes } from "@/lib/calculations/unit-conversions";
import { countedRoundTripKm } from "@/lib/calculations/round-trip";
import {
  aggregateTransportMassDistance,
  aggregateBiocharTransportMassDistance,
  type TransportLegsByCategory,
} from "@/lib/isometric/utils/aggregation";
import type {
  LedgerCategory,
  LedgerCategoryKey,
  LedgerDistanceBasis,
  LedgerLeg,
  LedgerModel,
} from "./types";

export interface BuildLedgerModelArgs {
  legsByCategory: TransportLegsByCategory;
  memberBatchCodes: string | null;
  facilityName: string | null;
  externalProjectId: string | null;
  generatedAtIso: string;
}

const CATEGORY_META: Record<
  LedgerCategoryKey,
  { name: string; tag: string; refPrefix: string }
> = {
  // Tags use "›" (chevron) not "→": the bundled DM Sans/Mono latin subset has
  // no U+2192 arrow glyph, so "→" renders as .notdef in the PDF. "›" is in the
  // subset and reads as a route connector. Same substitution in pdf.ts routes.
  feedstock: {
    name: "Feedstock collection",
    tag: "supplier › facility",
    refPrefix: "FL",
  },
  biochar: {
    name: "Biochar distribution",
    tag: "facility › application",
    refPrefix: "BL",
  },
  sample: { name: "Sample transfer", tag: "facility › laboratory", refPrefix: "SL" },
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

function geoOf(lat: number | null, lng: number | null): string | null {
  if (lat == null || lng == null) return null;
  return `${lat}, ${lng}`;
}

function basisOf(leg: TransportLeg): LedgerDistanceBasis {
  if (leg.isDerived) return "Map · derived";
  switch (leg.distanceSource) {
    case "manual":
      return "Map · manual";
    case "document":
      return "Document";
    default:
      return "Map · estimate";
  }
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

function buildLeg(leg: TransportLeg, ref: string): LedgerLeg {
  const loadMassKg =
    leg.loadMassKg != null && leg.loadMassKg > 0 ? leg.loadMassKg : 0;
  const massMissing = loadMassKg === 0;
  // Every leg counts its round trip (issue #852), so the row carries the
  // doubled distance into the t·km and reconciles to the category subtotal,
  // which `aggregateTransportMassDistance` also doubles.
  const effectiveDistanceKm = countedRoundTripKm(leg.distanceKm);
  const tkm = round2(effectiveDistanceKm * kgToTonnes(loadMassKg));
  const vehicle =
    leg.vehicleType && leg.modelYear
      ? `${leg.vehicleType} · ${leg.modelYear}`
      : (leg.vehicleType ?? null);
  return {
    ref,
    originName: leg.originName,
    destinationName: leg.destinationName,
    originGeo: geoOf(leg.originGpsLatitude, leg.originGpsLongitude),
    destinationGeo: geoOf(leg.destinationGpsLatitude, leg.destinationGpsLongitude),
    oneWayDistanceKm: leg.distanceKm,
    distanceKm: effectiveDistanceKm,
    loadMassKg,
    mode: capitalize(leg.transportMethodType),
    vehicle,
    basis: basisOf(leg),
    tkm,
    massMissing,
  };
}

function buildCategory(
  key: LedgerCategoryKey,
  legs: TransportLeg[],
): LedgerCategory {
  const meta = CATEGORY_META[key];
  const builtLegs = legs.map((leg, i) =>
    buildLeg(leg, `${meta.refPrefix}-${String(i + 1).padStart(2, "0")}`),
  );
  const canonical = key === "biochar"
    ? aggregateBiocharTransportMassDistance(legs)
    : aggregateTransportMassDistance(legs, meta.name);
  if (key === "biochar" && canonical.warning) throw new SafeError(canonical.warning);
  const rawTkm = canonical.massDistanceTonneKm ?? 0;
  const canonicalRawSubtotalTkm = round2(rawTkm);
  const displayedRowSumTkm = round2(
    builtLegs.reduce((sum, leg) => sum + leg.tkm, 0),
  );
  const roundingAdjustmentTkm = round2(
    canonicalRawSubtotalTkm - displayedRowSumTkm,
  );
  const base = {
    key,
    name: meta.name,
    tag: meta.tag,
    legs: builtLegs,
    ...(roundingAdjustmentTkm !== 0
      ? { displayedRowSumTkm, roundingAdjustmentTkm }
      : {}),
  };

  return { ...base, subtotalTkm: canonicalRawSubtotalTkm };
}

export function buildLedgerModel(args: BuildLedgerModelArgs): LedgerModel {
  const { legsByCategory } = args;
  const categories: LedgerCategory[] = [
    buildCategory("feedstock", legsByCategory.feedstock),
    buildCategory("biochar", legsByCategory.biochar),
    buildCategory("sample", legsByCategory.sample),
  ];
  const totalTkm = round2(
    categories.reduce((sum, c) => sum + c.subtotalTkm, 0),
  );
  const totalLegs = categories.reduce((sum, c) => sum + c.legs.length, 0);
  return {
    memberBatchCodes: args.memberBatchCodes,
    facilityName: args.facilityName,
    externalProjectId: args.externalProjectId,
    generatedAtIso: args.generatedAtIso,
    categories,
    totalTkm,
    totalLegs,
  };
}
