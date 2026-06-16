/**
 * FormSpine — a passive vertical process spine for multi-section sheet forms.
 *
 * Wraps a form's `FormSection` children and threads a thin gutter rail down the
 * left: a numbered marker per section joined by a connecting line, so the
 * operator reads the order of the process at a glance. The number is the
 * marker — it stays a number; nothing is gated and the form submits at any
 * time. The spine is orientation, not a wizard, and it is deliberately *silent*
 * about completion: certification readiness is a field-level concern carried by
 * the CERT chips, not by the rail (a green "done" tick on the rail conflated the
 * two and read as misleading). The only state the rail signals is a genuine
 * validation error, which tints the number red after the field is left or the
 * form is submitted.
 *
 * It is opt-in and non-invasive: a `FormSection` only grows the gutter when it
 * sits inside a `<FormSpine>` (which injects `__spine` + provides `control` via
 * context). Every standalone `FormSection` elsewhere renders exactly as before.
 *
 * Numbering follows render order of the *actually-rendered* sections, so a
 * conditionally-mounted section simply joins or leaves the rail and the numbers
 * stay contiguous — no ghost/locked steps.
 *
 * Forms prop-drill RHF (`control`) rather than using `FormProvider`, so the
 * control object is passed to `<FormSpine control={control}>` explicitly.
 */
"use client";

import * as React from "react";
import { useFormState, type Control } from "react-hook-form";
import { cn } from "@/lib/utils";

// ── Section marker state ───────────────────────────────────────────────────

/** Layout metadata FormSpine injects into each FormSection child. */
export interface SpineMeta {
  index: number;
  first: boolean;
  last: boolean;
  total: number;
}

/**
 * Does a section currently hold a surfaced validation error? Scoped to the
 * section's own fields so it doesn't re-render on unrelated changes. Errors only
 * surface once the user has left an invalid field or tried to submit — never
 * mid-keystroke (the form's `onTouched`/`onSubmit` mode gates them).
 */
function useSectionHasError(
  control: Control<Record<string, unknown>>,
  fields: string[],
): boolean {
  const { errors, touchedFields, isSubmitted } = useFormState({
    control,
    name: fields,
  });
  const anyError = fields.some((f) =>
    Boolean((errors as Record<string, unknown>)?.[f]),
  );
  const anyTouched = fields.some((f) =>
    Boolean((touchedFields as Record<string, unknown>)?.[f]),
  );
  return anyError && (isSubmitted || anyTouched);
}

// ── Marker ─────────────────────────────────────────────────────────────────

const MARKER = "h-24 w-24"; // mirrors StepFlow's StepIndex geometry

function SpineMarker({ hasError, n }: { hasError: boolean; n: number }) {
  return (
    <span
      aria-hidden
      className={cn(
        MARKER,
        "flex shrink-0 items-center justify-center border body-caption-fit font-medium transition-colors",
        hasError
          ? "border-[var(--st-bad)] bg-[var(--st-bad-bg)] text-[var(--st-bad)]"
          : "border-[var(--color-border-secondary)] text-[var(--color-text-tertiary)]",
      )}
    >
      {/* The number is the marker — kept through every state so the rail reads as
          orientation. Only an error recolours it (red), never a tick. */}
      {n}
    </span>
  );
}

// ── Section frame (gutter rail + content) ────────────────────────────────────

export interface SpineSectionFrameProps {
  meta: SpineMeta;
  hasError: boolean;
  /** Rendered label row (icon + title + chrome) — built by FormSection. */
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * Presentational shell: a 24px gutter (marker + connector) beside the section
 * content. The connector is absolutely positioned from just below the marker to
 * 16px past the section box, bridging the next section's top padding so the rail
 * reads as one continuous line meeting the next marker.
 */
export function SpineSectionFrame({
  meta,
  hasError,
  label,
  children,
  className,
}: SpineSectionFrameProps) {
  return (
    <section
      className={cn(
        "grid grid-cols-[24px_1fr] gap-x-12",
        !meta.first && "pt-16",
        className,
      )}
    >
      <div className="relative flex flex-col items-center">
        <SpineMarker hasError={hasError} n={meta.index + 1} />
        {!meta.last && (
          <span
            aria-hidden
            className="absolute left-1/2 top-24 bottom-[-16px] w-px -translate-x-1/2 bg-[var(--color-border-secondary)]"
          />
        )}
      </div>
      <div className="min-w-0 space-y-16">
        {label}
        {children}
      </div>
    </section>
  );
}

// ── Live / static section bodies ─────────────────────────────────────────────

interface SpineBodyProps {
  meta: SpineMeta;
  control: Control<Record<string, unknown>>;
  fields: string[];
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** Section with form fields — subscribes to RHF so the marker can flag errors. */
export function SpineSectionLive({
  meta,
  control,
  fields,
  label,
  children,
  className,
}: SpineBodyProps) {
  const hasError = useSectionHasError(control, fields);
  return (
    <SpineSectionFrame meta={meta} hasError={hasError} label={label} className={className}>
      {children}
    </SpineSectionFrame>
  );
}

/**
 * Display-only / field-less section (e.g. a preview) — just its step number.
 * Nothing to validate, so the marker stays a plain number.
 */
export function SpineSectionStatic({
  meta,
  label,
  children,
  className,
}: Pick<SpineBodyProps, "meta" | "label" | "children" | "className">) {
  return (
    <SpineSectionFrame meta={meta} hasError={false} label={label} className={className}>
      {children}
    </SpineSectionFrame>
  );
}

// ── Spine context + container ────────────────────────────────────────────────

interface SpineContextValue {
  control: Control<Record<string, unknown>>;
}

const SpineContext = React.createContext<SpineContextValue | null>(null);

export function useSpineContext(): SpineContextValue | null {
  return React.useContext(SpineContext);
}

/** Marker FormSpine uses to recognise FormSection children without importing it. */
export const SPINE_SECTION_TAG = "__isFormSection";

interface FormSpineProps {
  /**
   * RHF `control` from the form's `useForm()`. Typed loosely on purpose: RHF's
   * `Control` is invariant across its type params and `zodResolver` widens the
   * transformed-values param, so a precisely-typed control from any given form
   * can't be assigned to a fixed `Control<T>`. Sections address fields by string
   * name anyway, so the rail only needs a loose control. This is the single
   * boundary where the spine gives up exact form typing.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: Control<any>;
  children: React.ReactNode;
  className?: string;
}

export function FormSpine({ control, children, className }: FormSpineProps) {
  const looseControl = control as unknown as Control<Record<string, unknown>>;
  const value = React.useMemo(
    () => ({ control: looseControl }),
    [looseControl],
  );

  const flattenChildren = (nodes: React.ReactNode): React.ReactNode[] =>
    React.Children.toArray(nodes).flatMap((child) => {
      if (
        React.isValidElement(child) &&
        child.type === React.Fragment
      ) {
        return flattenChildren(
          (child.props as { children?: React.ReactNode }).children
        );
      }
      return [child];
    });

  // Count the spine sections that will actually render (falsy/hidden children
  // are skipped by React.Children), then inject contiguous index/first/last.
  const childArray = flattenChildren(children);
  const isSection = (c: React.ReactNode): c is React.ReactElement =>
    React.isValidElement(c) &&
    Boolean((c.type as { [SPINE_SECTION_TAG]?: boolean })?.[SPINE_SECTION_TAG]);

  // Positions (in the child list) of the sections that will actually render —
  // a section's spine index is its rank among these, so numbering stays
  // contiguous when a conditional section drops out. No mutable counter, so the
  // React Compiler stays happy.
  const sectionPositions = childArray.flatMap((c, idx) =>
    isSection(c) ? [idx] : [],
  );
  const total = sectionPositions.length;
  const mapped = childArray.map((child, idx) => {
    if (!isSection(child)) return child;
    const index = sectionPositions.indexOf(idx);
    const meta: SpineMeta = {
      index,
      first: index === 0,
      last: index === total - 1,
      total,
    };
    return React.cloneElement(child as React.ReactElement<{ __spine?: SpineMeta }>, {
      __spine: meta,
    });
  });

  return (
    <SpineContext.Provider value={value}>
      <div className={cn("flex flex-col", className)}>{mapped}</div>
    </SpineContext.Provider>
  );
}
