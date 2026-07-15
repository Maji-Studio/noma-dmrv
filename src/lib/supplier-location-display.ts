export interface SupplierLocationDisplayParts {
  name?: string | null;
  city?: string | null;
  stateRegion?: string | null;
  country?: string | null;
  isDefault?: boolean;
}

/** Compact, single-line label for a structured supplier source location. */
export function formatSupplierLocationDisplay(
  location: SupplierLocationDisplayParts | null | undefined,
): string | null {
  if (!location) return null;
  const parts = [
    location.name,
    location.city,
    location.stateRegion,
    location.country,
  ]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(", ") : null;
}

/** Resolve already-formatted legacy and nested labels for compact list cells. */
export function resolveSupplierLocationText(
  legacyLocation: string | null | undefined,
  nestedLocationDisplay: string | null | undefined,
): string | null {
  return legacyLocation?.trim() || nestedLocationDisplay?.trim() || null;
}

/** Legacy supplier text wins; otherwise use default, sole, or first location. */
export function resolveSupplierLocationDisplay(
  legacyLocation: string | null | undefined,
  locations: SupplierLocationDisplayParts[],
): string | null {
  const nested =
    locations.find((location) => location.isDefault) ?? locations[0];
  return resolveSupplierLocationText(
    legacyLocation,
    formatSupplierLocationDisplay(nested),
  );
}
