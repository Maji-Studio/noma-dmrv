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
}: {
  children: React.ReactNode;
  /** Optional explanatory text shown via an info icon next to the label. */
  hint?: React.ReactNode;
}) {
  return (
    <h3 className="flex items-center gap-6 body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
      {children}
      {hint != null && <InfoHint side="top">{hint}</InfoHint>}
    </h3>
  );
}
