import { SeedError } from "./actions";

const FORESTRY_NAMES_BY_PREFERENCE = [
  /^forestry waste$/i,
  /^forest(?:ry)?[\s_-]+(?:waste|residu\w*)$/i,
  /forest(?:ry)?[\s_-]+(?:waste|residu\w*)/i,
];

/** Prefer the requested name, then the closest forestry-residue catalogue name. */
export function selectForestryEntry<T extends { id: string; name: string }>(
  catalogue: readonly T[],
): T {
  for (const pattern of FORESTRY_NAMES_BY_PREFERENCE) {
    const matches = catalogue
      .filter(entry => pattern.test(entry.name.trim()))
      .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
    if (matches.length) return matches[0];
  }
  throw new SeedError("registry forestry catalogue: no forestry waste or forest residue entry found");
}
