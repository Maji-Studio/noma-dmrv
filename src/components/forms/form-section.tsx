/**
 * FormSection — the single section block for sheet forms.
 *
 * Encapsulates the production-run form grammar: mono uppercase SectionLabel
 * above a space-y-16 field stack, separated from the previous section by a
 * pt-16 hairline divider. The first section of a form passes
 * `divider={false}` (nothing to separate from).
 *
 * Forms compose sections directly under a `space-y-20` form element; the
 * section owns all intra-section rhythm so sheets can't drift.
 *
 * When wrapped in `<FormSpine>` (see ./form-spine), the section grows a left
 * gutter rail with a numbered, live-validating status marker and a connecting
 * line — turning a stack of sections into a readable process spine. Pass
 * `icon` (a leading glyph), `fields` (the section's RHF field names, for live
 * state) and `required` (which of them must be filled to count as complete).
 * Outside a spine these props are ignored and the section renders unchanged.
 */

import { cn } from "@/lib/utils";
import { SectionLabel } from "./section-label";
import {
  SPINE_SECTION_TAG,
  SpineSectionLive,
  SpineSectionStatic,
  useSpineContext,
  type CertReady,
  type SpineCompletion,
  type SpineMeta,
} from "./form-spine";

interface FormSectionProps {
  title: React.ReactNode;
  children: React.ReactNode;
  /** Hairline divider above the section (default) — first section disables it. Ignored inside a FormSpine. */
  divider?: boolean;
  /** Optional explanatory text shown via an info icon next to the label. */
  hint?: React.ReactNode;
  /** Show the CERT chip next to the label. */
  certifyRequired?: boolean;
  /** Trailing header chrome (e.g. an "Add" button or badge), right-aligned on the label row. */
  actions?: React.ReactNode;
  className?: string;
  /** Leading glyph for the label (Phosphor icon). Surfaces in the spine rail's label row. */
  icon?: React.ReactNode;
  /** RHF field names owned by this section — drives the spine marker's live state. */
  fields?: string[];
  /** Subset of `fields` that must be filled for the section to read as complete. */
  required?: string[];
  /** How completeness is judged when inside a spine (default `"required"`). */
  completion?: SpineCompletion;
  /**
   * Certification gate: given the section's watched values, returns true when
   * its CERT obligations are met. A section only goes green (complete) when its
   * required fields are filled AND this passes — so a green check can't appear
   * while a CERT field is unsatisfied.
   */
  certReady?: CertReady;
  /** Injected by FormSpine — do not set manually. */
  __spine?: SpineMeta;
}

export function FormSection({
  title,
  children,
  divider = true,
  hint,
  certifyRequired,
  actions,
  className,
  icon,
  fields,
  required,
  completion = "required",
  certReady,
  __spine,
}: FormSectionProps) {
  const spine = useSpineContext();

  const label = (
    <SectionLabel hint={hint} certifyRequired={certifyRequired} icon={icon}>
      {title}
    </SectionLabel>
  );
  const labelRow = actions ? (
    <div className="flex items-center justify-between gap-16">
      {label}
      {actions}
    </div>
  ) : (
    label
  );

  // Inside a FormSpine: render the gutter rail. Sections with fields subscribe
  // to RHF for live state; field-less display sections show a calm muted check.
  if (spine && __spine) {
    const sectionFields = fields ?? [];
    if (sectionFields.length === 0) {
      return (
        <SpineSectionStatic meta={__spine} label={labelRow} className={className}>
          {children}
        </SpineSectionStatic>
      );
    }
    return (
      <SpineSectionLive
        meta={__spine}
        control={spine.control}
        fields={sectionFields}
        required={required}
        completion={completion}
        certReady={certReady}
        label={labelRow}
        className={className}
      >
        {children}
      </SpineSectionLive>
    );
  }

  // Standalone (no spine): the original section grammar, unchanged.
  return (
    <section
      className={cn(
        "space-y-16",
        divider && "border-t border-[var(--color-border-tertiary)] pt-16",
        className,
      )}
    >
      {labelRow}
      {children}
    </section>
  );
}

// Lets FormSpine recognise its section children without a circular import.
(FormSection as unknown as Record<string, boolean>)[SPINE_SECTION_TAG] = true;
