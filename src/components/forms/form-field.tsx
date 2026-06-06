/**
 * FormField component
 * Wrapper component that provides label, children (input/textarea), and error display
 */

import { cloneElement, isValidElement, type ReactNode } from "react";
import { FormError } from "./form-error";
import { InfoHint } from "@/components/ui/tooltip";

interface FormFieldProps {
  id: string;
  label: string;
  error?: string;
  helperText?: string;
  /**
   * Explanatory text shown via an info ⓘ icon next to the label instead of
   * inline. Prefer this over `helperText` for longer prose so the form stays
   * compact; keep `helperText` for short, always-visible cues.
   */
  hint?: ReactNode;
  required?: boolean;
  certifyRequired?: boolean;
  children: ReactNode;
}

/**
 * Wire the error/helper text to the control via `aria-describedby` so screen
 * readers announce them when the field is focused. FormField owns the `id`
 * and renders both the control and its messages, so it is the only place that
 * can establish the association without every call site repeating it.
 *
 * The control is expected to be a single element whose own `id` matches the
 * FormField `id` (the established pattern — see FormInput/FormSelect usage).
 * When that holds, clone it to merge in `aria-describedby`; otherwise render
 * children untouched so atypical layouts don't break.
 */
function describeChild(
  children: ReactNode,
  describedBy: string | undefined
): ReactNode {
  if (!describedBy || !isValidElement(children)) return children;
  const childProps = children.props as { "aria-describedby"?: string };
  const merged = [childProps["aria-describedby"], describedBy]
    .filter(Boolean)
    .join(" ");
  return cloneElement(children, { "aria-describedby": merged } as Partial<
    typeof childProps
  >);
}

export function FormField({
  id,
  label,
  error,
  helperText,
  hint,
  required,
  certifyRequired,
  children,
}: FormFieldProps) {
  const errorId = `${id}-error`;
  const helperId = `${id}-helper`;
  const showHelper = Boolean(helperText) && !error;

  // Point the control at whichever message is actually rendered below it.
  const describedBy = error ? errorId : showHelper ? helperId : undefined;

  return (
    <div>
      {/* Keep the info icon a sibling of the label, not a child — a button
          inside a <label> would forward its clicks to the field control. */}
      <div className="flex items-center gap-6 mb-6">
        <label
          htmlFor={id}
          className="body-small font-medium text-[var(--color-text-secondary)]"
        >
          {label}
          {required && (
            <>
              <span className="text-[var(--color-signal-red)] ml-2" aria-hidden="true">*</span>
              <span className="sr-only">Required</span>
            </>
          )}
        </label>
        {certifyRequired && (
          <span className="body-caption border border-[var(--color-border-primary)] px-4 py-1 text-[var(--color-text-secondary)]">
            CERT<span className="sr-only">Required for certification</span>
          </span>
        )}
        {hint != null && <InfoHint side="top">{hint}</InfoHint>}
      </div>
      {describeChild(children, describedBy)}
      {showHelper && (
        <p
          id={helperId}
          className="body-caption text-[var(--color-text-tertiary)] mt-6"
        >
          {helperText}
        </p>
      )}
      <FormError id={errorId} message={error} />
    </div>
  );
}
