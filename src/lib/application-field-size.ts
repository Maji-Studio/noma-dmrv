export const FIELD_SIZE_REQUIRED_MESSAGE = "Field size is required";
export const FIELD_SIZE_POSITIVE_MESSAGE = "Field size must be greater than 0";
/** Input bounds keep entered areas inside the float4 `field_size_ha` column (1 m² up to 1,000,000 ha). */
export const MIN_FIELD_SIZE_HA = 0.0001;
export const MAX_FIELD_SIZE_HA = 1_000_000;
export const FIELD_SIZE_MIN_MESSAGE = `Field size must be at least ${MIN_FIELD_SIZE_HA} ha`;
export const FIELD_SIZE_MAX_MESSAGE = "Field size must be at most 1,000,000 ha";

/** Shared persisted/form predicate for application area. */
export function isPositiveApplicationFieldSize(
  fieldSizeHa: number | null | undefined,
): fieldSizeHa is number {
  return (
    fieldSizeHa != null && Number.isFinite(fieldSizeHa) && fieldSizeHa > 0
  );
}
