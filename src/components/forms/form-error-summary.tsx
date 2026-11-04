/**
 * FormErrorSummary
 * After a Save that validation refused, lists the fields that need fixing
 * above the Save button and moves focus to the first of them. Each entry is
 * a link that focuses its field. The list follows the form's live errors, so
 * a fixed field drops out and the summary goes once nothing is left.
 * Rendered by FormActions for every form that passes `control`.
 *
 * It is also the form's one error box: a server message (the lock reason, or
 * an issue for a field not on screen) shows as the detail under the count
 * line, and the references the refusal named (`action`) come last. With no
 * field errors it shows the message alone, and a refused save moves focus to
 * it, since the operator may be far above the end of a long form.
 */
"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  useFormState,
  type Control,
  type FieldValues,
  type FormState,
} from "react-hook-form";
import { Notice } from "@/components/ui/notice";
import { ServerError } from "./server-error";
import { pluralize } from "@/lib/copy-utils";
import {
  focusField,
  locateInDirectory,
  type FieldDirectory,
} from "./form-error-summary-dom";

/** Read once per refused save; the visible title keeps the live count. */
const ANNOUNCEMENT = "Not saved. Fix the fields that show an error.";
/** "Not saved. 1 field is locked." */
function lockedAnnouncement(count: number): string {
  return count === 1
    ? "Not saved. 1 field is locked."
    : `Not saved. ${count} ${pluralize(count, "field")} are locked.`;
}

/** `setError` type of a lock refusal (see `useSaveRefusal`): worded apart from a fix. */
export const LOCKED_ERROR_TYPE = "locked";

export interface FieldErrorItem {
  path: string;
  message: string;
  label: string | null;
  /** False when no control in the form matches the path: shown, not linked. */
  located: boolean;
  /** A lock refusal: counted as locked, not as a field to fix. */
  locked?: boolean;
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
): Array<{ path: string; message: string; locked?: boolean }> {
  const items: Array<{ path: string; message: string; locked?: boolean }> = [];
  const visit = (value: unknown, path: string) => {
    if (typeof value !== "object" || value === null) return;
    if (isLeafError(value)) {
      if (typeof value.message === "string" && value.message.length > 0) {
        items.push({ path, message: value.message, ...(value.type === LOCKED_ERROR_TYPE ? { locked: true } : {}) });
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
  errors: Array<{ path: string; message: string; locked?: boolean }>,
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

/**
 * The field's name only: "Share, row 2". The reason shows once, at the field.
 * An entry with no label (a field the form never named) shows its message.
 */
export function ItemText({ item }: { item: FieldErrorItem }) {
  const row = rowNumber(item.path);
  if (!item.label) {
    return <>{row === null ? item.message : `${item.message} (row ${row})`}</>;
  }
  return <>{row === null ? item.label : `${item.label}, row ${row}`}</>;
}

/**
 * "Not saved. Fix 2 fields." A lock is not a fix: "Not saved. 2 fields are
 * locked." Both together: "Not saved. Fix 1 field. 2 fields are locked."
 */
function countLabel(items: readonly FieldErrorItem[]): string {
  const locked = items.filter((item) => item.locked).length;
  const toFix = items.length - locked;
  const parts = ["Not saved."];
  if (toFix > 0) parts.push(`Fix ${toFix} ${pluralize(toFix, "field")}.`);
  if (locked > 0) parts.push(`${locked} ${pluralize(locked, "field")} ${locked === 1 ? "is" : "are"} locked.`);
  return parts.join(" ");
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
  /** The refusal's server message: the detail under the count line. */
  message?: string;
  /** References the refusal named, last in the box. */
  action?: ReactNode;
}

export function FormErrorSummary<
  TFieldValues extends FieldValues,
  TContext,
  TTransformed,
>({ control, directory, getForm, message, action }: FormErrorSummaryProps<TFieldValues, TContext, TTransformed>) {
  const formState = useFormState({ control });
  const { submitCount, isSubmitSuccessful } = formState;
  const items = orderFieldErrors(
    listFieldErrors(formState as FormState<FieldValues>),
    directory,
  );
  const visible = submitCount > 0 && !isSubmitSuccessful && items.length > 0;
  const firstPath = visible ? items[0].path : null;
  const focusedAttempt = useRef(submitCount);
  const boxRef = useRef<HTMLDivElement>(null);
  const detailId = useId();
  const focusedBox = useRef(submitCount);
  const messageOnly = !visible && Boolean(message);
  const allLocked = items.length > 0 && items.every((item) => item.locked);
  // A locked field is about to be disabled: focus goes to the first field to fix.
  const focusPath = items.find((item) => !item.locked)?.path ?? null;

  // Sanctioned useEffect: moving focus after a refused save is imperative DOM
  // work. Once per attempt, and after react-hook-form's own focus (it runs a
  // zero-delay timer queued before this render), so the first field in the
  // form gets focus, not the first one registered.
  useEffect(() => {
    if (firstPath === null || focusedAttempt.current === submitCount) return;
    // One consumed attempt across both paths: a lock keeps its message, and
    // once the field is put back the message-only box must not take focus.
    focusedBox.current = submitCount;
    const timer = setTimeout(() => {
      focusedAttempt.current = submitCount;
      // Every item a lock: the field turns disabled once the lock re-read
      // lands, so it is not focused. The box takes focus, whether or not a
      // reason sits beside the count, so the reason is read from it. If the
      // record then turns read-only, this box goes and the top refusal takes
      // focus and says something else, so nothing is read twice.
      if (focusPath === null) {
        const box = boxRef.current;
        box?.scrollIntoView({ block: "nearest" });
        box?.focus({ preventScroll: true });
        return;
      }
      focusField(getForm(), focusPath);
    }, 0);
    return () => clearTimeout(timer);
  }, [firstPath, focusPath, submitCount, getForm]);

  // Sanctioned useEffect: a refusal with no field to focus (a whole-record
  // lock) leaves the message in a box at the end of the form, possibly below
  // the operator. Bring it into view and focus it, once per attempt. RHF
  // counts the attempt as successful when no field error was filed, so the
  // attempt count, not `isSubmitSuccessful`, tells a new attempt apart.
  useEffect(() => {
    if (!messageOnly || submitCount === 0 || focusedBox.current === submitCount) return;
    focusedBox.current = submitCount;
    const box = boxRef.current;
    if (!box) return;
    box.scrollIntoView({ block: "nearest" });
    box.focus({ preventScroll: true });
  }, [messageOnly, submitCount]);

  // The list changes as fields are fixed; announcing it whole on every
  // change would drown the field the user is editing. One line per refused
  // save instead, mounted for the whole attempt, so the summary leaving and
  // coming back while the user edits does not announce it again.
  // The attempt whose refusal listed fields. Adjusted while rendering, so a
  // save that failed without field errors (a thrown action) never claims
  // fields, and a list that empties and refills keeps the same line.
  const [announced, setAnnounced] = useState({ attempt: 0, lockedOnly: 0 });
  // Locked items when every listed item is a lock, else 0.
  const lockedOnly = items.length > 0 && items.every((item) => item.locked) ? items.length : 0;
  if (visible && announced.attempt !== submitCount) setAnnounced({ attempt: submitCount, lockedOnly });
  const announcedAttempt = announced.attempt;
  // A lock-only refusal moves focus to the box, which is read from there: no
  // second line for it (see the focus effect).
  const focusReadsBox = announced.lockedOnly > 0;
  const announcement = announcedAttempt === submitCount && submitCount > 0 && !isSubmitSuccessful && !focusReadsBox ? (
    <p key={submitCount} role="alert" className="sr-only">
      {announced.lockedOnly > 0 ? lockedAnnouncement(announced.lockedOnly) : ANNOUNCEMENT}
    </p>
  ) : null;

  // One wrapper for both branches, so focus on it survives the list clearing.
  return (
    <>
      {announcement}
      <div
        ref={boxRef}
        tabIndex={-1}
        data-form-error-box=""
        className="mt-auto! empty:hidden"
        // Focus reads a named group (the count, then the reason and the fields);
        // the message-only box is an alert already. A label that held the field
        // names would also match the fields' own label lookups.
        role={visible ? "group" : undefined}
        aria-label={visible ? countLabel(items) : undefined}
        aria-describedby={visible ? detailId : undefined}
      >
      {!visible ? (
        message && <ServerError message={message} action={action} />
      ) : (
      <Notice tone="error" live={false} title={countLabel(items)} data-form-error-summary="">
        <div id={detailId}>
          {message && <p className="body-small">{" "}{message}</p>}
          <ul className="mt-4 flex flex-col">
            {items.map((item) => (
              <li key={item.path}>
                {item.located ? (
                  <a
                    href={`#${item.path}`}
                    className="flex min-h-44 items-center py-4 text-[var(--color-text-primary)] underline underline-offset-2"
                    onClick={(event) => {
                      event.preventDefault();
                      // A locked field is disabled, so its link only scrolls to it.
                      focusField(getForm(), item.path, { focus: !item.locked });
                    }}
                  >
                    {/* One span keeps the label and message flowing as text. */}
                    <span>
                      <ItemText item={item} />
                    </span>
                  </a>
                ) : (
                  <p className="body-small flex min-h-44 items-center py-4">{item.message}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
        {action && <div className="mt-8">{action}</div>}
      </Notice>
      )}
      </div>
    </>
  );
}
