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
 *
 * Pass `explanation` (with the section's `explanationTitle`) when the section
 * has tables or arithmetic to show: the one (i) then opens a panel with the
 * `hint` first and the explanation under it, so a title never carries two (i)s.
 */

import { ExplanationInfo } from "@/components/ui/explanation-info";
import { InfoHint } from "@/components/ui/tooltip";
import {
  CertificationFieldTag,
  type CertFieldStatus,
} from "@/components/ui/certification-field-tag";

export function SectionLabel({
  children,
  hint,
  explanation,
  explanationTitle,
  certifyRequired,
  certifyStatus,
  certifyDescription,
  icon,
}: {
  children: React.ReactNode;
  /** Optional explanatory text shown via an info icon next to the label. */
  hint?: React.ReactNode;
  /** Tables or arithmetic behind the section, shown in the (i) panel. */
  explanation?: React.ReactNode;
  /** Names the panel and the (i); defaults to the label text when it is a string. */
  explanationTitle?: string;
  certifyRequired?: boolean;
  /** Saved-state colour for the CERT chip; only meaningful with `certifyRequired`. */
  certifyStatus?: CertFieldStatus;
  /** Tooltip text naming the missing item; defaults to the generic status wording. */
  certifyDescription?: string;
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
      {certifyRequired && <CertificationFieldTag status={certifyStatus} description={certifyDescription} />}
      {explanation != null && explanation !== false
        ? <ExplanationInfo title={explanationTitle ?? (typeof children === "string" ? children : "Details")} hint={hint}>{explanation}</ExplanationInfo>
        : hint != null && <InfoHint side="top">{hint}</InfoHint>}
    </h3>
  );
}
