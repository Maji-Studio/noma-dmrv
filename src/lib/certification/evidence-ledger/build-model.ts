/**
 * Pure builder: removal transport legs → Evidence Ledger view model.
 *
 * No I/O, no clock reads (generatedAtIso is injected). Per-leg t·km is rounded
 * to 2 dp and subtotals are the sum of those rounded legs, so the displayed
 * "Σ legs = subtotal = total" reconciliation is exact, not just approximate.
 */
import type { TransportLeg } from "@/db/schema";
import type {
  LedgerCategory,
  LedgerCategoryKey,
  LedgerDistanceBasis,
  LedgerLeg,
  LedgerModel,
} from "./types";

export interface TransportLegsByCategory {
  feedstock: TransportLeg[];
  biochar: TransportLeg[];
  sample: TransportLeg[];
}

export interface BuildLedgerModelArgs {
  legsByCategory: TransportLegsByCategory;
  removalCode: string | null;
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
  const massMissing = leg.loadMassKg == null;
  const loadMassKg = leg.loadMassKg ?? 0;
  const tkm = round2((leg.distanceKm * loadMassKg) / 1000);
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
    distanceKm: leg.distanceKm,
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
  const subtotalTkm = round2(builtLegs.reduce((sum, l) => sum + l.tkm, 0));
  return { key, name: meta.name, tag: meta.tag, legs: builtLegs, subtotalTkm };
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
    removalCode: args.removalCode,
    facilityName: args.facilityName,
    externalProjectId: args.externalProjectId,
    generatedAtIso: args.generatedAtIso,
    categories,
    totalTkm,
    totalLegs,
  };
}
