/**
 * FormField component
 * Wrapper component that provides label, children (input/textarea), and error display
 */

import { cloneElement, isValidElement, type CSSProperties, type ReactNode } from "react";
import { FormError } from "./form-error";
import { InfoHint } from "@/components/ui/tooltip";
import {
  CertificationFieldTag,
  type CertFieldStatus,
} from "@/components/ui/certification-field-tag";
import { cn } from "@/lib/utils";

/**
 * Room the control keeps at its end for a `unit` suffix: the unit's own width
 * in `ch` plus the input's end padding and a gap, both on the spacing scale.
 */
const UNIT_END_SPACE = "var(--spacing-24)";

interface FormFieldProps {
  id: string;
  label: string;
  error?: string;
  /** Non-blocking field advisory. Hidden whenever a blocking error is present. */
  warning?: string;
  /**
   * Explanation of the field. Always rendered behind the info ⓘ beside the
   * label (after `hint`), never as a visible line. A short line the operator
   * needs while typing belongs in `cue` instead.
   */
  helperText?: string;
  /** Explanatory content for the info ⓘ beside the label. */
  hint?: ReactNode;
  /**
   * A short visible line under the control, for a unit, a limit or a
   * consequence the operator needs while typing ("0 to 100% of wet mass",
   * "Only an empty bin can switch to split."). Everything else is `hint`.
   */
  cue?: string;
  /**
   * Unit suffix shown inside the end of the control ("kg", "%", "km"), so the
   * label needs no "(kg)". The accessible name keeps the unit.
   */
  unit?: string;
  required?: boolean;
  certifyRequired?: boolean;
  /**
   * Saved-state of the certification field. It colours the CERT chip (orange when
   * the saved record is missing this field, green when present). Defaults to
   * neutral. Only meaningful when `certifyRequired` is set.
   */
  certifyStatus?: CertFieldStatus;
  /** A short derived figure at the end of the label row, such as what a reading row draws. */
  aside?: ReactNode;
  children: ReactNode;
}

function hasText(value: string | undefined): value is string {
  return (value?.trim().length ?? 0) > 0;
}

function composeHintContent(hint: ReactNode, helperText: string | undefined) {
  if (!hasText(helperText)) return hint;
  if (hint == null) return helperText;

  return (
    <span className="flex flex-col gap-6">
      <span>{hint}</span>
      <span>{helperText}</span>
    </span>
  );
}

interface ControlDecoration {
  describedBy: string | undefined;
  invalid: boolean;
  unit: string | undefined;
}

/**
 * Wire the messages to the control via `aria-describedby` so screen readers
 * announce them when the field is focused. FormField owns the `id` and renders
 * both the control and its messages, so it is the only place that can
 * establish the association without every call site repeating it.
 *
 * The control is expected to be a single element whose own `id` matches the
 * FormField `id` (the established pattern — see FormInput/FormSelect usage).
 * When that holds, clone it to merge in `aria-describedby` (and, with a unit,
 * the end space the suffix needs); otherwise render children untouched so
 * atypical layouts don't break.
 */
function describeChild(
  children: ReactNode,
  { describedBy, invalid, unit }: ControlDecoration
): ReactNode {
  if ((!describedBy && !invalid && !unit) || !isValidElement(children)) return children;
  const childProps = children.props as {
    "aria-describedby"?: string;
    "aria-invalid"?: boolean | "true" | "false";
    className?: string;
    style?: CSSProperties;
  };
  const merged = [childProps["aria-describedby"], describedBy]
    .filter(Boolean)
    .join(" ");
  return cloneElement(children, {
    ...(merged ? { "aria-describedby": merged } : {}),
    "aria-invalid": invalid ? true : childProps["aria-invalid"],
    ...(unit
      ? {
          // `peer` lets the suffix dim with a disabled control.
          className: cn(childProps.className, "peer"),
          style: {
            ...childProps.style,
            paddingInlineEnd: `calc(${unit.length}ch + ${UNIT_END_SPACE})`,
          },
        }
      : {}),
  } as Partial<typeof childProps>);
}

export function FormField({
  id,
  label,
  error,
  warning,
  helperText,
  hint,
  cue,
  unit,
  required,
  certifyRequired,
  certifyStatus,
  aside,
  children,
}: FormFieldProps) {
  const errorId = `${id}-error`;
  const warningId = `${id}-warning`;
  const cueId = `${id}-cue`;
  const explanationId = `${id}-helper`;
  const certId = `${id}-cert`;
  const hintContent = composeHintContent(hint, helperText);
  const hasExplanation = hintContent != null;
  const showWarning = Boolean(warning) && !error;
  // One caption line under the control at a time: an error or warning
  // replaces the cue while it shows.
  const showCue = hasText(cue) && !error && !showWarning;

  // Point the control at whichever message is rendered below it, then the
  // explanation behind the ⓘ, then the CERT chip.
  const describedBy =
    [
      error ? errorId : showWarning ? warningId : showCue ? cueId : undefined,
      !error && !showWarning && hasExplanation ? explanationId : undefined,
      certifyRequired ? certId : undefined,
    ]
      .filter(Boolean)
      .join(" ") || undefined;

  const control = describeChild(children, {
    describedBy,
    invalid: Boolean(error),
    unit,
  });

  // Keep the info icon a sibling of the label, not a child — a button
  // inside a <label> would forward its clicks to the field control.
  // Top-align so a wrapped multi-line label keeps the CERT chip / ⓘ icon
  // beside its first line instead of floating them in the vertical
  // middle of the wrapped text.
  const labelRow = (spacing: string) => (
    <div className={`flex min-h-24 items-start gap-6 ${spacing}`}>
      <label
        htmlFor={id}
        className="body-small font-medium text-[var(--color-text-secondary)]"
      >
        {label}
        {unit && <span className="sr-only"> ({unit})</span>}
        {required && (
          <>
            <span className="text-[var(--color-signal-red)] ml-2" aria-hidden="true">*</span>
            <span className="sr-only">Required</span>
          </>
        )}
      </label>
      {certifyRequired && (
        // The 24px row centres the CERT chip on the ⓘ's line.
        <span className="inline-flex min-h-24 items-center">
          <CertificationFieldTag status={certifyStatus} descriptionId={certId} />
        </span>
      )}
      {hasExplanation && (
        <InfoHint side="top" label={`More about ${label}`} descriptionId={explanationId}>
          {hintContent}
        </InfoHint>
      )}
    </div>
  );

  return (
    <div>
      {/* With an aside the label group and the aside wrap as two units, so
          the ⓘ stays beside the label. The margin sits on a wrapper div:
          type classes beat margin utilities. */}
      {aside != null ? (
        <div className="flex flex-wrap items-start gap-x-6 mb-6">
          {labelRow("")}
          <div className="ml-auto whitespace-nowrap">
            <span className="body-caption text-[var(--color-text-tertiary)] tabular-nums">{aside}</span>
          </div>
        </div>
      ) : labelRow("mb-6")}
      {unit ? (
        <div className="relative">
          {control}
          {/* Part of the control's box, so the capture counts it as control
              text. aria-hidden: the label carries the unit for screen readers. */}
          <span
            aria-hidden="true"
            data-control-unit=""
            className="pointer-events-none absolute inset-y-0 right-12 flex items-center text-[length:var(--text-s)] text-[var(--color-text-tertiary)] peer-disabled:opacity-50"
          >
            {unit}
          </span>
        </div>
      ) : (
        control
      )}
      {hasExplanation && (
        <span id={explanationId} className="sr-only">
          {hintContent}
        </span>
      )}
      {showCue && (
        <div className="mt-6">
          <p id={cueId} className="body-caption text-[var(--color-text-tertiary)]">
            {cue}
          </p>
        </div>
      )}
      {showWarning && (
        <p
          id={warningId}
          className="body-caption text-[var(--st-wait)] mt-6"
          role="status"
          aria-live="polite"
        >
          {warning}
        </p>
      )}
      <FormError id={errorId} message={error} />
    </div>
  );
}
