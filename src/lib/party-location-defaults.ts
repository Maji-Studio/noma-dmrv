/**
 * Default-location rules for a party's (supplier or customer) location list.
 * One default always exists while any location does, and only one at a time.
 * Mirrors the server: the first location is default, a default write clears
 * the others, and deleting the default promotes the first remaining location.
 */

interface DefaultableLocation {
  isDefault: boolean;
}

/** Whether a new location should start with "default" checked. */
export function shouldStartAsDefault(existingCount: number): boolean {
  return existingCount === 0;
}

function withSingleDefault<T extends DefaultableLocation>(
  locations: T[],
  defaultIndex: number,
): T[] {
  return locations.map((location, index) =>
    location.isDefault === (index === defaultIndex)
      ? location
      : { ...location, isDefault: index === defaultIndex },
  );
}

function ensureDefault<T extends DefaultableLocation>(
  locations: T[],
  preferredIndex = 0,
): T[] {
  if (locations.length === 0 || locations.some((l) => l.isDefault)) {
    return locations;
  }
  return withSingleDefault(locations, preferredIndex);
}

export function withAddedLocation<T extends DefaultableLocation>(
  locations: T[],
  added: T,
): T[] {
  const next = [...locations, added];
  if (locations.length === 0 || added.isDefault) {
    return withSingleDefault(next, next.length - 1);
  }
  return ensureDefault(
    next.map((l, i) => (i === next.length - 1 ? { ...l, isDefault: false } : l)),
  );
}

export function withUpdatedLocation<T extends DefaultableLocation>(
  locations: T[],
  index: number,
  updated: T,
): T[] {
  const next = locations.map((current, i) => (i === index ? updated : current));
  if (updated.isDefault) return withSingleDefault(next, index);
  // Unchecking the only default keeps it: a default must always exist.
  return ensureDefault(next, index);
}

export function withoutLocation<T extends DefaultableLocation>(
  locations: T[],
  index: number,
): T[] {
  return ensureDefault(locations.filter((_, i) => i !== index));
}
