/**
 * Display logic for the feedstock form's "Distance source" select.
 *
 * "Supplier default" is a UI-only choice (not a persisted provenance value):
 * it means "this distance tracks the supplier's stored default". The form may
 * only claim it when the draft was actually seeded from the supplier default
 * or the operator explicitly chose it — never by relabeling a saved transport
 * leg's own provenance just because the numbers coincide (DR-002 /
 * FS-26-001: read said "Route calculation", edit said "Supplier default").
 */
import type { DistanceSourceValue } from "@/schemas/distance-source";

interface SupplierDefaultDisplayInput {
  /**
   * The draft distance/source came from the record's own saved transport leg
   * (edit mode, unchanged supplier, leg distance present). A saved leg's
   * provenance is authoritative and must display verbatim.
   */
  seededFromSavedLeg: boolean;
  storedDistanceKm: number | null;
  storedDistanceSource: DistanceSourceValue | null;
  transportDistanceKm: number | null | undefined;
  draftTransportDistanceSource: DistanceSourceValue | null | undefined;
}

export function matchesSupplierDefaultForDisplay({
  seededFromSavedLeg,
  storedDistanceKm,
  storedDistanceSource,
  transportDistanceKm,
  draftTransportDistanceSource,
}: SupplierDefaultDisplayInput): boolean {
  if (seededFromSavedLeg) return false;
  return (
    storedDistanceKm != null &&
    transportDistanceKm === storedDistanceKm &&
    draftTransportDistanceSource === storedDistanceSource &&
    draftTransportDistanceSource !== "document"
  );
}
