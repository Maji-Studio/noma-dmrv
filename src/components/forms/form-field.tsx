/**
 * FormField component
 * Wrapper component that provides label, children (input/textarea), and error display
 */

import { cloneElement, isValidElement, type ReactNode } from "react";
import { FormError } from "./form-error";
import { InfoHint } from "@/components/ui/tooltip";
import {
  CertificationFieldTag,
  type CertFieldStatus,
} from "@/components/ui/certification-field-tag";

const INLINE_HELPER_MAX_CHARS = 64;

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
  /**
   * Saved-state of the certification field — colours the CERT chip (orange when
   * the saved record is missing this field, green when present). Defaults to
   * neutral. Only meaningful when `certifyRequired` is set.
   */
  certifyStatus?: CertFieldStatus;
  children: ReactNode;
}

function shouldCollapseHelperText(helperText: string | undefined): helperText is string {
  return (helperText?.trim().length ?? 0) > INLINE_HELPER_MAX_CHARS;
}

function composeHintContent(hint: ReactNode, collapsedHelperText: string | undefined) {
  if (!collapsedHelperText) return hint;
  if (hint == null) return collapsedHelperText;

  return (
    <span className="flex flex-col gap-6">
      <span>{hint}</span>
      <span>{collapsedHelperText}</span>
    </span>
  );
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
  describedBy: string | undefined,
  invalid: boolean
): ReactNode {
  if ((!describedBy && !invalid) || !isValidElement(children)) return children;
  const childProps = children.props as {
    "aria-describedby"?: string;
    "aria-invalid"?: boolean | "true" | "false";
  };
  const merged = [childProps["aria-describedby"], describedBy]
    .filter(Boolean)
    .join(" ");
  return cloneElement(children, {
    ...(merged ? { "aria-describedby": merged } : {}),
    "aria-invalid": invalid ? true : childProps["aria-invalid"],
  } as Partial<typeof childProps>);
}

export function FormField({
  id,
  label,
  error,
  helperText,
  hint,
  required,
  certifyRequired,
  certifyStatus,
  children,
}: FormFieldProps) {
  const errorId = `${id}-error`;
  const helperId = `${id}-helper`;
  const collapsedHelperText = shouldCollapseHelperText(helperText)
    ? helperText
    : undefined;
  const inlineHelperText = collapsedHelperText ? undefined : helperText;
  const hintContent = composeHintContent(hint, collapsedHelperText);
  const showInlineHelper = Boolean(inlineHelperText) && !error;
  const showScreenReaderHelper = Boolean(collapsedHelperText) && !error;

  // Point the control at whichever message is actually rendered below it.
  const describedBy = error
    ? errorId
    : showInlineHelper || showScreenReaderHelper
      ? helperId
      : undefined;

  return (
    <div>
      {/* Keep the info icon a sibling of the label, not a child — a button
          inside a <label> would forward its clicks to the field control.
          Top-align so a wrapped multi-line label keeps the CERT tag / ⓘ icon
          beside its first line instead of floating them in the vertical
          middle of the wrapped text. */}
      <div className="flex items-start gap-6 mb-6">
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
        {certifyRequired && <CertificationFieldTag status={certifyStatus} />}
        {hintContent != null && (
          <InfoHint side="top" label={`More about ${label}`}>
            {hintContent}
          </InfoHint>
        )}
      </div>
      {describeChild(children, describedBy, Boolean(error))}
      {showInlineHelper && (
        <p
          id={helperId}
          className="body-caption text-[var(--color-text-tertiary)] mt-6"
        >
          {inlineHelperText}
        </p>
      )}
      {showScreenReaderHelper && <p id={helperId} className="sr-only">{collapsedHelperText}</p>}
      <FormError id={errorId} message={error} />
    </div>
  );
}
