import type { EntityOption } from "./types";

/**
 * EntitySelect shows an option's code as secondary disambiguation only. When
 * the entity is itself code-named (credit batches, for example), repeating the
 * same value on both sides of the row adds noise instead of information.
 */
export function getEntityOptionCodeLabel(
  option: EntityOption,
): string | undefined {
  return option.code && option.code !== option.name ? option.code : undefined;
}
