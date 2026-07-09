/**
 * Pure builder: removal transport legs → Evidence Ledger view model.
 *
 * No I/O, no clock reads (generatedAtIso is injected). Per-leg t·km is rounded
 * for display only; category subtotals use the canonical raw-sum transport
 * aggregator, rounded only at the subtotal.
 *
 * Reconciliation contract: each category's `subtotalTkm` equals the scalar
 * submitted to the registry. Feedstock/sample (PRODUCTION bucket) submit the
 * raw leg-sum; biochar (DELIVERY bucket, §8.6.2/ADR 0020) submits leg-sum ×
 * the applied-biochar share, so for a partially-applied removal the model
 * carries the raw sum + fraction in `scaling` and the PDF renders the
 * multiplication explicitly — the per-leg rows still reconcile.
 */
import type { TransportLeg } from "@/db/schema";
import { kgToTonnes } from "@/lib/calculations/unit-conversions";
import { roundTripDistanceFactor } from "@/schemas/trip-type";
import {
  aggregateTransportMassDistance,
  clampFactor,
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
  /**
   * Removal-wide applied-biochar share (§8.6.2 DELIVERY bucket, ADR 0020) —
   * pass `appliedBiocharFraction(ctx.runSummary)` so the biochar subtotal
   * matches the submitted scalar. Omitted / ≥1 ⇒ full application (raw sums,
   * pre-#349 model shape).
   */
  appliedBiocharFraction?: number;
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
  // Round-trip legs (#316, §4.2) carry the doubled distance into the t·km so the
  // per-leg row reconciles to the category subtotal, which
  // `aggregateTransportMassDistance` also doubles.
  const factor = roundTripDistanceFactor(leg.tripType);
  const effectiveDistanceKm = leg.distanceKm * factor;
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
    distanceKm: effectiveDistanceKm,
    loadMassKg,
    roundTrip: factor > 1,
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
  // DELIVERY-bucket share — only the biochar category receives one (§8.6.2).
  appliedFraction?: number,
): LedgerCategory {
  const meta = CATEGORY_META[key];
  const builtLegs = legs.map((leg, i) =>
    buildLeg(leg, `${meta.refPrefix}-${String(i + 1).padStart(2, "0")}`),
  );
  const canonical = aggregateTransportMassDistance(legs, meta.name);
  const rawTkm = canonical.massDistanceTonneKm ?? 0;
  const base = { key, name: meta.name, tag: meta.tag, legs: builtLegs };

  // Mirror the submit pipeline exactly: `enrichWithTransportLegs` scales the
  // raw sum by the clamped fraction. A fraction ≥ 1 (or none) is full
  // application — keep the raw subtotal AND omit `scaling` so the content
  // hash of fully-applied ledgers is unchanged.
  const fraction = clampFactor(appliedFraction);
  if (appliedFraction == null || fraction >= 1) {
    return { ...base, subtotalTkm: round2(rawTkm) };
  }
  return {
    ...base,
    subtotalTkm: round2(rawTkm * fraction),
    scaling: { rawSubtotalTkm: round2(rawTkm), appliedFraction: fraction },
  };
}

export function buildLedgerModel(args: BuildLedgerModelArgs): LedgerModel {
  const { legsByCategory } = args;
  const categories: LedgerCategory[] = [
    buildCategory("feedstock", legsByCategory.feedstock),
    buildCategory("biochar", legsByCategory.biochar, args.appliedBiocharFraction),
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
