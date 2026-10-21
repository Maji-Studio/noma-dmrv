"use client";

/**
 * Show a refused save at the fields it names (#1298). A form calls the
 * returned function from its submit `catch`, inside the `handleSubmit`
 * callback: react-hook-form works out `isSubmitSuccessful` once when the
 * callback ends, and the error summary shows only after an unsuccessful
 * submit, so a server error set any later would never be listed or focused.
 * The function files each issue on its field with `setError` and returns the
 * text for the footer, or null when the form has nothing to add (not a
 * refusal with issues, or a stale-version or conflict refusal), so the caller
 * keeps its own message for those.
 */
import { get, useFormState, type Control, type FieldValues, type Path, type UseFormSetError } from "react-hook-form";
import { planSaveRefusal } from "@/lib/save-refusal";
import { LOCKED_ERROR_TYPE } from "./form-error-summary";
import { locateInDirectory, readFieldDirectory } from "./form-error-summary-dom";

/** `setError` type of a refused save's field error. */
export const SERVER_ERROR_TYPE = "server";

export interface SaveRefusalOutcome {
  /** What the footer says, or null when every issue sits at a field. */
  footer: string | null;
}

export type SaveRefusalHandler = (error: unknown) => SaveRefusalOutcome | null;

interface UseSaveRefusalOptions<TFieldValues extends FieldValues, TContext, TTransformed> {
  control: Control<TFieldValues, TContext, TTransformed>;
  setError: UseFormSetError<TFieldValues>;
  /** The `<form>` element's id; its controls say which fields are on screen. */
  formId: string;
  /** Server path to form field name, kept next to the form's payload builder. */
  aliases?: Readonly<Record<string, string>>;
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
  formId,
  aliases,
  isEnabled,
}: UseSaveRefusalOptions<TFieldValues, TContext, TTransformed>): SaveRefusalHandler {
  const { dirtyFields } = useFormState({ control });
  return (error) => {
    const form = document.getElementById(formId);
    const plan = planSaveRefusal(error, {
      aliases,
      isShown: (field) => isRendered(form, field) && (isEnabled?.(field) ?? true),
      isChanged: (field) => Boolean(get(dirtyFields, field)),
    });
    if (!plan) return null;
    for (const { field, message, locked } of plan.fieldErrors) {
      setError(field as Path<TFieldValues>, { type: locked ? LOCKED_ERROR_TYPE : SERVER_ERROR_TYPE, message });
    }
    return { footer: plan.footer };
  };
}
