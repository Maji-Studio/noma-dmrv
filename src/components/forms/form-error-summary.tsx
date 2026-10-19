/**
 * FormErrorSummary
 * After a Save that validation refused, lists the fields that need fixing
 * above the Save button and moves focus to the first of them. Each entry is
 * a link that focuses its field. The list follows the form's live errors, so
 * a fixed field drops out and the summary goes once nothing is left.
 * Rendered by FormActions for every form that passes `control`.
 */
"use client";

import { useEffect, useRef } from "react";
import {
  useFormState,
  type Control,
  type FieldValues,
  type FormState,
} from "react-hook-form";
import { Notice } from "@/components/ui/notice";
import {
  focusField,
  locateInDirectory,
  type FieldDirectory,
} from "./form-error-summary-dom";

/**
 * A long list scrolls inside the sticky footer instead of pushing the
 * fields off a phone screen. `dvh` shrinks with the on-screen keyboard.
 */
const LIST_HEIGHT_CLASS = "max-h-[20dvh] overflow-y-auto";

/** Read once per refused save; the visible title keeps the live count. */
const ANNOUNCEMENT = "Not saved. Fix the fields that show an error.";

export interface FieldErrorItem {
  path: string;
  message: string;
  label: string | null;
  /** False when no control in the form matches the path: shown, not linked. */
  located: boolean;
}

function isLeafError(value: object): value is { message?: unknown; type?: unknown } {
  return "type" in value || "message" in value;
}

/**
 * Flatten RHF errors into one entry per field path in the order RHF holds
 * them. Skips the form-level `root` (server errors show in ServerError),
 * errors without a message, and the empty path: the Zod resolver also files
 * each union branch's issue there, a copy of the union field's own error.
 * Takes the whole form state, not `errors`: RHF updates `errors` in place,
 * so only the form state object changes identity when an error clears, and
 * the compiler's memo must key on that.
 */
export function listFieldErrors(
  formState: Pick<FormState<FieldValues>, "errors">,
): Array<{ path: string; message: string }> {
  const items: Array<{ path: string; message: string }> = [];
  const visit = (value: unknown, path: string) => {
    if (typeof value !== "object" || value === null) return;
    if (isLeafError(value)) {
      if (typeof value.message === "string" && value.message.length > 0) {
        items.push({ path, message: value.message });
      }
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      visit(child, path ? `${path}.${key}` : key);
    }
  };
  for (const [key, value] of Object.entries(formState.errors)) {
    if (key !== "root" && key !== "") visit(value, key);
  }
  return items;
}

/**
 * Put errors in the order the fields appear and give each its label, from
 * the directory read when Save was pressed. An error with no matching
 * control keeps its place after the located ones and shows its message
 * only, without a link.
 */
export function orderFieldErrors(
  errors: Array<{ path: string; message: string }>,
  directory: FieldDirectory | null,
): FieldErrorItem[] {
  return errors
    .map((error, order) => {
      const entry = directory ? locateInDirectory(directory, error.path) : null;
      return {
        // Without a directory (a save not started from Save) every entry
        // keeps its link; the click still finds its control when it exists.
        item: { ...error, label: entry?.label ?? null, located: directory === null || entry !== null },
        rank: entry ? entry.index : Number.POSITIVE_INFINITY,
        order,
      };
    })
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map(({ item }) => item);
}

/** The 1-based row of a field array entry ("ingredients.1.share" is row 2). */
function rowNumber(path: string): number | null {
  const index = path.split(".").find((segment) => /^\d+$/.test(segment));
  return index === undefined ? null : Number(index) + 1;
}

/** "Identifier is required" already names its field; no "Identifier:" lead. */
function namesItsField(label: string, message: string): boolean {
  return message.toLowerCase().startsWith(label.toLowerCase());
}

/**
 * "Share, row 2: Enter at most 100." A message that already names its field
 * keeps only the row: "Blend material is required (row 2)".
 */
export function ItemText({ item }: { item: FieldErrorItem }) {
  const row = rowNumber(item.path);
  if (!item.label || namesItsField(item.label, item.message)) {
    return <>{row === null ? item.message : `${item.message} (row ${row})`}</>;
  }
  return (
    <>
      <span className="font-medium">{row === null ? item.label : `${item.label}, row ${row}`}</span>
      {": "}
      {item.message}
    </>
  );
}

function countLabel(count: number): string {
  return `Not saved. Fix ${count} ${count === 1 ? "field" : "fields"}.`;
}

interface FormErrorSummaryProps<
  TFieldValues extends FieldValues,
  TContext,
  TTransformed,
> {
  control: Control<TFieldValues, TContext, TTransformed>;
  /** Labels and order of the form's controls, read when Save was pressed. */
  directory: FieldDirectory | null;
  /** The form element that holds the fields. */
  getForm: () => HTMLElement | null;
}

export function FormErrorSummary<
  TFieldValues extends FieldValues,
  TContext,
  TTransformed,
>({ control, directory, getForm }: FormErrorSummaryProps<TFieldValues, TContext, TTransformed>) {
  const formState = useFormState({ control });
  const { submitCount, isSubmitSuccessful } = formState;
  const items = orderFieldErrors(
    listFieldErrors(formState as FormState<FieldValues>),
    directory,
  );
  const visible = submitCount > 0 && !isSubmitSuccessful && items.length > 0;
  const firstPath = visible ? items[0].path : null;
  const focusedAttempt = useRef(submitCount);

  // Sanctioned useEffect: moving focus after a refused save is imperative DOM
  // work. Once per attempt, and after react-hook-form's own focus (it runs a
  // zero-delay timer queued before this render), so the first field in the
  // form gets focus, not the first one registered.
  useEffect(() => {
    if (firstPath === null || focusedAttempt.current === submitCount) return;
    const timer = setTimeout(() => {
      focusedAttempt.current = submitCount;
      focusField(getForm(), firstPath);
    }, 0);
    return () => clearTimeout(timer);
  }, [firstPath, submitCount, getForm]);

  // The list changes as fields are fixed; announcing it whole on every
  // change would drown the field the user is editing. One line per refused
  // save instead, mounted for the whole attempt, so the summary leaving and
  // coming back while the user edits does not announce it again.
  const announcement = submitCount === 0 ? null : (
    <p key={submitCount} role="alert" className="sr-only">
      {isSubmitSuccessful ? "" : ANNOUNCEMENT}
    </p>
  );

  if (!visible) return announcement;

  return (
    <>
      {announcement}
      <Notice tone="error" live={false} title={countLabel(items.length)} data-form-error-summary="">
        <ul className={`mt-4 flex flex-col gap-4 ${LIST_HEIGHT_CLASS}`}>
          {items.map((item) => (
            <li key={item.path}>
              {item.located ? (
                <a
                  href={`#${item.path}`}
                  className="block min-h-24 py-2 text-[var(--color-text-primary)] underline underline-offset-2"
                  onClick={(event) => {
                    event.preventDefault();
                    focusField(getForm(), item.path);
                  }}
                >
                  <ItemText item={item} />
                </a>
              ) : (
                <p className="py-2">{item.message}</p>
              )}
            </li>
          ))}
        </ul>
      </Notice>
    </>
  );
}
