import type { DistanceSourceValue } from "@/schemas/distance-source";

/** The existing dashboard/readiness definition of document-backed distance. */
export const DOCUMENT_BACKED_DISTANCE_SOURCE =
  "document" satisfies DistanceSourceValue;

export function hasDocumentBackedDistanceProvenance(
  source: DistanceSourceValue | null | undefined,
): boolean {
  return source === DOCUMENT_BACKED_DISTANCE_SOURCE;
}
