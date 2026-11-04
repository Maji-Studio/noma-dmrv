/**
 * Place names as one line. A town that is also its region ("Ihemi, Ihemi")
 * reads once; a facility with no place text falls back to its coordinates.
 */

/** Trimmed, non-empty parts joined with ", ", dropping a part that repeats an earlier one (case ignored). */
export function joinLocationParts(parts: ReadonlyArray<string | null | undefined>): string | null {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const part of parts) {
    const text = part?.trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(text);
  }
  return kept.length > 0 ? kept.join(", ") : null;
}

/** The facility's place text, else its coordinates when both are set, else null (not recorded). */
export function formatFacilityLocation(facility: {
  location?: string | null;
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
}): string | null {
  const place = facility.location?.trim();
  if (place) return place;
  const { gpsLatitude, gpsLongitude } = facility;
  if (gpsLatitude == null || gpsLongitude == null) return null;
  return `${gpsLatitude}, ${gpsLongitude}`;
}
