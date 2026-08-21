/**
 * SectionLabel — reusable form section header
 *
 * Pass `hint` to attach an info ⓘ icon that reveals explanatory text on
 * hover/focus, instead of letting that prose occupy layout space.
 */

import { InfoHint } from "@/components/ui/tooltip";
import {
  CertificationFieldTag,
  type CertFieldStatus,
} from "@/components/ui/certification-field-tag";

export function SectionLabel({
  children,
  hint,
  certifyRequired,
  certifyStatus,
  icon,
}: {
  children: React.ReactNode;
  /** Optional explanatory text shown via an info icon next to the label. */
  hint?: React.ReactNode;
  certifyRequired?: boolean;
  /** Saved-state colour for the CERT chip; only meaningful with `certifyRequired`. */
  certifyStatus?: CertFieldStatus;
  /** Optional leading glyph (e.g. a Phosphor icon) rendered before the label text. */
  icon?: React.ReactNode;
}) {
  return (
    <h3 className="flex items-center gap-6 body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
      {icon != null && (
        <span className="inline-flex shrink-0 text-[var(--color-text-secondary)]">
          {icon}
        </span>
      )}
      {children}
      {certifyRequired && <CertificationFieldTag status={certifyStatus} />}
      {hint != null && <InfoHint side="top">{hint}</InfoHint>}
    </h3>
  );
}
