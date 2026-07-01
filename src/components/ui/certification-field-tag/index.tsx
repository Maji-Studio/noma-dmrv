"use client";

import { cn } from "@/lib/utils";

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

const STATUS_DESCRIPTION: Record<CertFieldStatus, string> = {
  neutral: "Required for certification",
  missing: "Required for certification — not yet provided",
  satisfied: "Required for certification — provided",
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
  return (
    <span
      className={cn(
        // `relative` gives the absolutely-positioned `.sr-only` child below a
        // positioned containing block. Without it, the sr-only span resolves its
        // static position against <html>; inside a wide, horizontally-scrolled
        // table its border-box lands far to the right and inflates the document
        // scroll width, producing page-level horizontal scroll on mobile.
        "relative body-caption border px-4 py-1",
        STATUS_STYLES[status],
        className,
      )}
    >
      {label}
      <span className="sr-only">{description ?? STATUS_DESCRIPTION[status]}</span>
    </span>
  );
}
