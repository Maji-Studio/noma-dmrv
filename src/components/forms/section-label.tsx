/**
 * SectionLabel — reusable form section header
 *
 * A sentence case title in the field label style, in primary ink. It sits
 * under the sheet title (`title-heading-4`) and beside the spine's numbered
 * marker, which already carry the hierarchy, so the title needs no eyebrow
 * treatment and no size of its own.
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
    <h3 className="flex min-h-24 items-center gap-6 body-small font-medium text-[var(--color-text-primary)]">
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
