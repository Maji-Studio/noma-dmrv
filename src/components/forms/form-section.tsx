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
 */

import { cn } from "@/lib/utils";
import { SectionLabel } from "./section-label";

interface FormSectionProps {
  title: React.ReactNode;
  children: React.ReactNode;
  /** Hairline divider above the section (default) — first section disables it. */
  divider?: boolean;
  /** Optional explanatory text shown via an info icon next to the label. */
  hint?: React.ReactNode;
  /** Show the CERT chip next to the label. */
  certifyRequired?: boolean;
  /** Trailing header chrome (e.g. an "Add" button or badge), right-aligned on the label row. */
  actions?: React.ReactNode;
  className?: string;
}

export function FormSection({
  title,
  children,
  divider = true,
  hint,
  certifyRequired,
  actions,
  className,
}: FormSectionProps) {
  const label = (
    <SectionLabel hint={hint} certifyRequired={certifyRequired}>
      {title}
    </SectionLabel>
  );

  return (
    <section
      className={cn(
        "space-y-16",
        divider && "border-t border-[var(--color-border-tertiary)] pt-16",
        className
      )}
    >
      {actions ? (
        <div className="flex items-center justify-between gap-16">
          {label}
          {actions}
        </div>
      ) : (
        label
      )}
      {children}
    </section>
  );
}
