/**
 * Form Utilities
 *
 * Shared coercion functions for React Hook Form's `setValueAs` option.
 * Use these instead of inline lambdas to keep form registrations concise.
 */

/** Empty/null/undefined → undefined, otherwise parseFloat. For optional number fields. */
export const numericValue = (v: unknown): number | undefined =>
  v === "" || v === null || v === undefined ? undefined : parseFloat(String(v));

/** Empty → null, otherwise Number(). For nullable number fields (e.g. measurements). */
export const nullableNumericValue = (v: unknown): number | null =>
  v === "" || v === null || v === undefined ? null : Number(v);

/** Empty → undefined, otherwise parseInt. For optional integer fields. */
export const integerValue = (v: unknown): number | undefined =>
  v === "" || v === null || v === undefined ? undefined : parseInt(String(v), 10);
