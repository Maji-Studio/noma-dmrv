export const FIELD_SIZE_REQUIRED_MESSAGE = "Field size is required";
export const FIELD_SIZE_POSITIVE_MESSAGE = "Field size must be greater than 0";

/** Shared persisted/form predicate for application area. */
export function isPositiveApplicationFieldSize(
  fieldSizeHa: number | null | undefined,
): fieldSizeHa is number {
  return (
    fieldSizeHa != null && Number.isFinite(fieldSizeHa) && fieldSizeHa > 0
  );
}
