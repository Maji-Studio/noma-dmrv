/**
 * View model for the Transport Emissions Evidence Ledger PDF.
 *
 * A pure, render-agnostic description of the per-leg `mass_distance` ledger that
 * backs a Removal's submitted transport scalars. Built by `build-model.ts` from
 * the removal's real transport legs; consumed by `pdf.tsx` (react-pdf). Keeping
 * the model free of any react-pdf type means the math is unit-testable without a
 * renderer, and "Σ legs = subtotal = claim" is decided here, not in the layout.
 */

export type LedgerCategoryKey = "feedstock" | "biochar" | "sample";

/**
 * `documents.metadata.kind` tag for an auto-generated transport evidence ledger.
 * Lets the submit pipeline locate (and supersede) a removal's prior ledgers
 * independent of which member credit batch they were attached to.
 */
export const TRANSPORT_EVIDENCE_LEDGER_KIND = "transport_evidence_ledger";

export interface TransportEvidenceLedgerDocMetadata {
  kind: typeof TRANSPORT_EVIDENCE_LEDGER_KIND;
  removalId: string;
  /** Semantic fingerprint of the ledger (legs/totals, excluding render time). */
  contentHash: string;
}

// Provenance of a leg's distance, normalised for display from the leg's
// `distanceSource` + `isDerived`. Mirrors the mockup's "Map · derived" /
// "Map · manual" chips.
export type LedgerDistanceBasis =
  | "Map · derived"
  | "Map · manual"
  | "Map · estimate"
  | "Document";

export interface LedgerLeg {
  /** Display ref, e.g. "FL-01" / "BL-03" / "SL-02". */
  ref: string;
  originName: string | null;
  destinationName: string | null;
  /** "lat, lng" or null when GPS not recorded. */
  originGeo: string | null;
  destinationGeo: string | null;
  distanceKm: number;
  loadMassKg: number;
  /** Capitalised mode, e.g. "Road" / "Rail". */
  mode: string;
  vehicle: string | null;
  basis: LedgerDistanceBasis;
  /** distanceKm × loadMassKg ÷ 1000 — this leg's contribution to mass_distance. */
  tkm: number;
  /** True when load mass was missing (tkm computed as 0) — surfaced in the row. */
  massMissing: boolean;
}

export interface LedgerCategory {
  key: LedgerCategoryKey;
  /** "Feedstock collection" etc. */
  name: string;
  /** "supplier → facility" etc. */
  tag: string;
  legs: LedgerLeg[];
  subtotalTkm: number;
}

export interface LedgerModel {
  removalCode: string | null;
  facilityName: string | null;
  externalProjectId: string | null;
  /** ISO date string, injected by the caller (no clock reads in the builder). */
  generatedAtIso: string;
  /** Always three entries (feedstock, biochar, sample) for the claim band. */
  categories: LedgerCategory[];
  totalTkm: number;
  totalLegs: number;
}
