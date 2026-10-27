"use client";

/**
 * Show a refused save at the fields it names (#1298). A form calls the
 * returned function from its submit `catch`, inside the `handleSubmit`
 * callback: react-hook-form works out `isSubmitSuccessful` once when the
 * callback ends, and the error summary shows only after an unsuccessful
 * submit, so a server error set any later would never be listed or focused.
 * The function files each issue on its field with `setError` and returns the
 * plan's footer (including null when every issue sits at a field), or the
 * caller's fallback when there is no plan.
 */
import { get, useFormState, type Control, type FieldValues, type Path, type UseFormResetField, type UseFormSetError } from "react-hook-form";
import { isLockRefusal, LOCKED_FIELD_MESSAGE, planSaveRefusal, shouldMarkLockedField } from "@/lib/save-refusal";
import { LOCKED_ERROR_TYPE } from "./form-error-summary";
import { locateInDirectory, readFieldDirectory } from "./form-error-summary-dom";

/**
 * Form-level marker of a lock refusal, filed under `errors.root` (which the
 * error summary skips and the next submit clears). `FormActions` reads it to
 * word the top refusal of a form that turned read-only.
 */
export const LOCK_REFUSAL_ROOT = "root.lockRefusal";

/** `setError` type of a refused save's field error. */
export const SERVER_ERROR_TYPE = "server";

export type SaveRefusalHandler = (error: unknown, fallback: string) => string | null;

interface UseSaveRefusalOptions<TFieldValues extends FieldValues, TContext, TTransformed> {
  control: Control<TFieldValues, TContext, TTransformed>;
  setError: UseFormSetError<TFieldValues>;
  resetField: UseFormResetField<TFieldValues>;
  /** The `<form>` element's id; its controls say which fields are on screen. */
  formId: string;
  /** Server path to form field name, kept next to the form's payload builder. */
  aliases?: Readonly<Record<string, string>>;
  /**
   * A server field the form splits across several controls (a combined instant
   * as a date and a time). A change to any control counts as a change to the
   * field, and a refusal files its error on, and a lock reverts, every control.
   */
  splitFields?: Readonly<Record<string, readonly string[]>>;
  /** Restore these registered fields when their parent is reverted by a lock. */
  dependents?: Partial<Record<Path<TFieldValues>, readonly Path<TFieldValues>[]>>;
  /** Changes held outside RHF, such as a draw editor mapped to its mass field. */
  isChanged?: (field: string) => boolean;
  /** Extra state the DOM cannot show, such as a section the form leaves out. */
  isEnabled?: (field: string) => boolean;
}

/** On screen as an editable control: found in the form and not read-only. */
function isRendered(form: HTMLElement | null, field: string): boolean {
  if (!form) return false;
  const directory = readFieldDirectory(form);
  if (!locateInDirectory(directory, field)) return false;
  const control = form.querySelector<HTMLElement>(
    [`[name="${CSS.escape(field)}"]`, `[id="${CSS.escape(field)}"]`, `[data-field-name="${CSS.escape(field)}"]`].join(","),
  );
  return !(control instanceof HTMLInputElement && control.readOnly);
}

export function useSaveRefusal<TFieldValues extends FieldValues, TContext, TTransformed>({
  control,
  setError,
  resetField,
  formId,
  aliases,
  splitFields,
  dependents,
  isChanged,
  isEnabled,
}: UseSaveRefusalOptions<TFieldValues, TContext, TTransformed>): SaveRefusalHandler {
  const { dirtyFields } = useFormState({ control });
  return (error, fallback) => {
    const form = document.getElementById(formId);
    const options = {
      aliases,
      isShown: (field: string) => isRendered(form, field) && (isEnabled?.(field) ?? true),
      isChanged: (field: string) => (splitFields?.[field] ?? [field]).some((part) => Boolean(get(dirtyFields, part))) || (isChanged?.(field) ?? false),
    };
    const plan = planSaveRefusal(error, options);
    if (!plan) return fallback;
    const resets = new Set<Path<TFieldValues>>();
    const dependentFields = new Set<Path<TFieldValues>>();
    for (const { field, locked } of plan.fieldErrors) {
      if (!locked) continue;
      for (const part of splitFields?.[field] ?? [field]) {
        resets.add(part as Path<TFieldValues>);
      }
    }
    for (const parent of resets) {
      for (const dependent of dependents?.[parent] ?? []) {
        if (!resets.has(dependent)) dependentFields.add(dependent);
      }
    }
    // Decide markers before resetField clears dirtyFields. Reset everything
    // before filing errors, because a related reset can clear another error.
    const markedDependents = [...dependentFields].filter(field => shouldMarkLockedField(field, options));
    for (const field of new Set([...resets, ...dependentFields])) resetField(field);
    for (const { field, message, locked } of plan.fieldErrors) {
      for (const part of splitFields?.[field] ?? [field]) {
        setError(part as Path<TFieldValues>, { type: locked ? LOCKED_ERROR_TYPE : SERVER_ERROR_TYPE, message });
      }
    }
    for (const field of markedDependents) {
      setError(field, { type: LOCKED_ERROR_TYPE, message: LOCKED_FIELD_MESSAGE });
    }
    if (isLockRefusal(error)) setError(LOCK_REFUSAL_ROOT as Path<TFieldValues>, { type: LOCKED_ERROR_TYPE });
    return plan.footer;
  };
}
