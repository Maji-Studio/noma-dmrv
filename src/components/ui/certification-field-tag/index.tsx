"use client";

import type { ReactNode } from "react";
import { CheckIcon, WarningIcon } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";

const CERTIFICATION_FIELD_TAG_LABEL = "CERT";

/**
 * Saved-state of a certification field, surfaced as the chip's colour:
 * - `neutral` — no claim (create mode, or a field with no saved record yet)
 * - `missing` — the saved record left this field blank (orange)
 * - `satisfied` — the saved record carries this field (green)
 *
 * See `@/components/forms/cert-field-status` for how a form derives it from its
 * frozen saved values.
 */
export type CertFieldStatus = "neutral" | "missing" | "satisfied";

const STATUS_STYLES: Record<CertFieldStatus, string> = {
  neutral:
    "border-[var(--color-border-primary)] text-[var(--color-text-secondary)]",
  missing:
    "border-[var(--st-wait-border)] bg-[var(--st-wait-bg)] text-[var(--st-wait)]",
  satisfied:
    "border-[var(--st-ok-border)] bg-[var(--st-ok-bg)] text-[var(--st-ok)]",
};

/**
 * The chip's own explanation, and the **requiredness legend seam** (DR-015).
 *
 * A form carries two independent requiredness systems: the red asterisk on
 * `FormField` (`@/components/forms/form-field`) blocks *saving*, this CERT chip
 * blocks *certification*. Nothing on screen tells an operator that, and the
 * legend's wording is an open decision — see `docs/open-questions.md`.
 *
 * When that decision lands, build the legend from this map plus the asterisk's
 * `sr-only` "Required" copy, and mount it once per form/read sheet. Do not
 * retype either explanation at the legend: one source, two surfaces.
 */
export const CERT_FIELD_STATUS_DESCRIPTION: Record<CertFieldStatus, string> = {
  neutral: "Required for certification",
  missing: "Required for certification. Not provided.",
  satisfied: "Required for certification. Provided.",
};

// Provided/not-provided must not be signalled by chip hue alone (WCAG 1.4.1);
// the glyph is the non-colour marker. Assistive tech gets the sr-only string,
// so the icon stays decorative. 12px is a deliberate step below the 16px
// small-icon scale: it matches the app's micro-chip glyphs (entity code
// chips) and keeps the marker legible without dominating the caption type.
const STATUS_GLYPHS: Record<CertFieldStatus, ReactNode> = {
  neutral: null,
  missing: <WarningIcon size={12} weight="bold" aria-hidden />,
  satisfied: <CheckIcon size={12} weight="bold" aria-hidden />,
};

interface CertificationFieldTagProps {
  className?: string;
  label?: string;
  description?: string;
  /** Saved-state colour. Defaults to `neutral` (no claim). */
  status?: CertFieldStatus;
}

export function CertificationFieldTag({
  className,
  label = CERTIFICATION_FIELD_TAG_LABEL,
  description,
  status = "neutral",
}: CertificationFieldTagProps) {
  const explanation = description ?? CERT_FIELD_STATUS_DESCRIPTION[status];
  return (
    // The badge recurs ~10×/form, so the same explanation is exposed two ways
    // without adding it to the tab order (that many stops would swamp keyboard
    // nav): an always-on `.sr-only` string for assistive tech, and a pointer
    // tooltip that makes the text visible to sighted users, who previously saw
    // an unexplained "CERT" chip (redesign §6). The chip stays a non-interactive
    // span — the tooltip is a supplementary hover hint, not a control.
    <Tooltip content={explanation}>
      <span
        className={cn(
          // `relative` gives the absolutely-positioned `.sr-only` child below a
          // positioned containing block. Without it, the sr-only span resolves its
          // static position against <html>; inside a wide, horizontally-scrolled
          // table its border-box lands far to the right and inflates the document
          // scroll width, producing page-level horizontal scroll on mobile.
          "relative body-caption inline-flex items-center gap-2 border px-4 py-1",
          STATUS_STYLES[status],
          className,
        )}
      >
        {STATUS_GLYPHS[status]}
        {label}
        <span className="sr-only">{explanation}</span>
      </span>
    </Tooltip>
  );
}
