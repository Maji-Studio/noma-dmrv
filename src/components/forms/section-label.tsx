/**
 * SectionLabel — reusable form section header
 *
 * Pass `hint` to attach an info ⓘ icon that reveals explanatory text on
 * hover/focus, instead of letting that prose occupy layout space.
 */

import { InfoHint } from "@/components/ui/tooltip";

export function SectionLabel({
  children,
  hint,
  certifyRequired,
}: {
  children: React.ReactNode;
  /** Optional explanatory text shown via an info icon next to the label. */
  hint?: React.ReactNode;
  certifyRequired?: boolean;
}) {
  return (
    <h3 className="flex items-center gap-6 body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
      {children}
      {certifyRequired && (
        <span className="border border-[var(--color-border-primary)] px-4 py-1 text-[var(--color-text-secondary)]">
          CERT<span className="sr-only">Required for certification</span>
        </span>
      )}
      {hint != null && <InfoHint side="top">{hint}</InfoHint>}
    </h3>
  );
}
