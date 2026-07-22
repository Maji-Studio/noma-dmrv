/**
 * CERT-chip status — reflects an entity's *saved* (persisted) state, frozen.
 *
 * A CERT chip stays neutral while a record is being created, and once the
 * record has been saved and reopened it reports whether each certification
 * field was actually persisted: orange when the saved value is still missing,
 * green when it is present. The status is read from a frozen snapshot of the
 * form's saved values (its `defaultValues` in edit mode), so a chip never flips
 * mid-keystroke — it updates only when the record is re-saved and the sheet is
 * reopened with fresh defaults. This keeps certification feedback honest about
 * what is on file, not about an in-flight draft.
 */
import type { CertFieldStatus } from "@/components/ui/certification-field-tag";

export type { CertFieldStatus };

export const isCertFieldValuePresent = (value: unknown): boolean => {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  return true;
};

/**
 * Resolve any saved certification requirement, including composite/derived
 * requirements that cannot be inferred from one field value. `persisted`
 * stays undefined while the saved record is unknown (for example, while an
 * async child query loads), so the UI makes no orange/green claim yet.
 */
export function resolveCertFieldStatus(
  persisted: boolean | undefined,
  satisfied: boolean,
): CertFieldStatus {
  if (persisted !== true) return "neutral";
  return satisfied ? "satisfied" : "missing";
}

/**
 * Build a resolver that reports a CERT field's saved state. Pass the form's
 * saved values (the same object handed to `useForm({ defaultValues })`) when
 * editing, or `undefined` in create mode — where every chip stays neutral.
 * Address fields by their form field name (the FormField `id`).
 */
export function makeCertFieldStatus(
  savedValues: Record<string, unknown> | undefined,
): (fieldName: string) => CertFieldStatus {
  return (fieldName) => {
    if (!savedValues) return "neutral";
    return resolveCertFieldStatus(
      true,
      isCertFieldValuePresent(savedValues[fieldName]),
    );
  };
}
