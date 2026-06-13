/**
 * FormSpine — a passive vertical process spine for multi-section sheet forms.
 *
 * Wraps a form's `FormSection` children and threads a thin gutter rail down the
 * left: a numbered status marker per section joined by a connecting line, so the
 * operator reads the order of the process at a glance. Markers carry *live*
 * validation state (gray → amber → green check / red warning) derived from each
 * section's own fields — but nothing is gated: every section stays rendered and
 * the form submits at any time. The spine is orientation, not a wizard.
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
import { useWatch, useFormState, type Control } from "react-hook-form";
import { Check, Warning } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";

// ── Section completion state ───────────────────────────────────────────────

export type SpineState =
  | "untouched" // nothing entered yet (also: display-only / no-obligation sections)
  | "active" // being edited / partially filled, or required filled but cert not yet clean
  | "complete" // every obligation met — required filled AND cert-clean
  | "error"; // an invalid field (after blur or submit)

/** How a section judges its required set. */
export type SpineCompletion =
  /** Required = the explicit `required` list (default). */
  | "required"
  /** Required = every field in `fields`. */
  | "all";

/**
 * A section's certification gate. Given its watched values keyed by field name,
 * returns true when the section's CERT obligations are met. Lets the form keep
 * domain rules local (e.g. "status must be complete") instead of the spine
 * guessing. Omit when a section has no cert obligation.
 */
export type CertReady = (values: Record<string, unknown>) => boolean;

/** Layout metadata FormSpine injects into each FormSection child. */
export interface SpineMeta {
  index: number;
  first: boolean;
  last: boolean;
  total: number;
}

const isFilled = (v: unknown): boolean =>
  v !== undefined &&
  v !== null &&
  v !== "" &&
  !(typeof v === "number" && Number.isNaN(v));

/**
 * Derive a section's live state from its fields. Scoped RHF subscriptions
 * (`name: fields`) keep this from re-rendering on unrelated field changes.
 */
function useSectionState(
  control: Control<Record<string, unknown>>,
  fields: string[],
  required: string[] | undefined,
  completion: SpineCompletion,
  certReady: CertReady | undefined,
): SpineState {
  const values = useWatch({ control, name: fields });
  const { errors, touchedFields, isSubmitted } = useFormState({
    control,
    name: fields,
  });

  const valArr = Array.isArray(values) ? values : [values];
  const filledAt = (i: number) => isFilled(valArr[i]);
  const valuesByName: Record<string, unknown> = Object.fromEntries(
    fields.map((f, i) => [f, valArr[i]]),
  );

  const reqList = completion === "all" ? fields : (required ?? []);
  const anyFilled = fields.some((_, i) => filledAt(i));
  const reqFilled = reqList.every((f) => filledAt(fields.indexOf(f)));
  const certOk = certReady ? certReady(valuesByName) : true;
  // A section can only claim "complete" if it actually has something to
  // satisfy — otherwise a check would appear with nothing behind it (the bug:
  // an empty required list is vacuously "filled").
  const hasObligation = reqList.length > 0 || Boolean(certReady);
  const anyError = fields.some((f) =>
    Boolean((errors as Record<string, unknown>)?.[f]),
  );
  const anyTouched = fields.some((f) =>
    Boolean((touchedFields as Record<string, unknown>)?.[f]),
  );

  // Red only once the user has left an invalid field or tried to submit —
  // never mid-keystroke (the form's `onTouched`/`onSubmit` mode gates errors).
  if (anyError && (isSubmitted || anyTouched)) return "error";
  // Green ONLY when every obligation is met: required filled AND cert-clean.
  if (hasObligation && reqFilled && certOk) return "complete";
  if (anyFilled || anyTouched) return "active";
  return "untouched";
}

// ── Marker ─────────────────────────────────────────────────────────────────

const MARKER = "h-24 w-24"; // mirrors StepFlow's StepIndex geometry

function SpineMarker({ state, n }: { state: SpineState; n: number }) {
  return (
    <span
      aria-hidden
      className={cn(
        MARKER,
        "flex shrink-0 items-center justify-center border body-caption-fit font-medium transition-colors",
        state === "untouched" &&
          "border-[var(--color-border-secondary)] text-[var(--color-text-tertiary)]",
        state === "active" &&
          "border-[var(--st-wait)] bg-[var(--st-wait-bg)] text-[var(--st-wait)]",
        state === "complete" &&
          "border-[var(--st-ok)] bg-[var(--st-ok)] text-white",
        state === "error" &&
          "border-[var(--st-bad)] bg-[var(--st-bad)] text-white",
      )}
    >
      {/* A check appears ONLY when genuinely complete — never as decoration. */}
      {state === "complete" ? (
        <Check size={13} weight="bold" />
      ) : state === "error" ? (
        <Warning size={13} weight="bold" />
      ) : (
        n
      )}
    </span>
  );
}

// ── Section frame (gutter rail + content) ────────────────────────────────────

export interface SpineSectionFrameProps {
  meta: SpineMeta;
  state: SpineState;
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
  state,
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
        <SpineMarker state={state} n={meta.index + 1} />
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
  required?: string[];
  completion: SpineCompletion;
  certReady?: CertReady;
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** Section with form fields — subscribes to RHF for live state. */
export function SpineSectionLive({
  meta,
  control,
  fields,
  required,
  completion,
  certReady,
  label,
  children,
  className,
}: SpineBodyProps) {
  const state = useSectionState(control, fields, required, completion, certReady);
  return (
    <SpineSectionFrame meta={meta} state={state} label={label} className={className}>
      {children}
    </SpineSectionFrame>
  );
}

/**
 * Display-only / field-less section (e.g. a preview) — just its step number, no
 * status claim. It never shows a check, because the form can't vouch for any
 * completion here.
 */
export function SpineSectionStatic({
  meta,
  label,
  children,
  className,
}: Pick<SpineBodyProps, "meta" | "label" | "children" | "className">) {
  return (
    <SpineSectionFrame meta={meta} state="untouched" label={label} className={className}>
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

  // Count the spine sections that will actually render (falsy/hidden children
  // are skipped by React.Children), then inject contiguous index/first/last.
  const childArray = React.Children.toArray(children);
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
