"use client";

import type { Icon } from "@phosphor-icons/react";
import { SealCheckIcon, SealIcon, SealWarningIcon } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";

/** The seal is a 14px label-row glyph, the ⓘ glyph's size, on every surface. */
const CERT_GLYPH_PX = 14;

/**
 * Saved-state of a certification field, surfaced as the seal's colour and mark:
 * - `neutral` — no claim (create mode, or a field with no saved record yet)
 * - `missing` — the saved record left this field blank (orange, warning seal)
 * - `satisfied` — the saved record carries this field (green, checked seal)
 *
 * See `@/components/forms/cert-field-status` for how a form derives it from its
 * frozen saved values.
 */
export type CertFieldStatus = "neutral" | "missing" | "satisfied";

const STATUS_INK: Record<CertFieldStatus, string> = {
  neutral: "text-[var(--color-text-secondary)]",
  missing: "text-[var(--st-wait)]",
  satisfied: "text-[var(--st-ok)]",
};

// Provided/not-provided must not be signalled by hue alone (WCAG 1.4.1): the
// mark inside the seal is the non-colour cue. The plain seal makes no claim,
// so a create form never shows a tick that reads as "done".
const STATUS_GLYPHS: Record<CertFieldStatus, Icon> = {
  neutral: SealIcon,
  missing: SealWarningIcon,
  satisfied: SealCheckIcon,
};

/**
 * The glyph's own explanation. The same wording heads the sheet legend
 * (`CertificationLegend`), so there is one source for both surfaces.
 */
export const CERT_FIELD_STATUS_DESCRIPTION: Record<CertFieldStatus, string> = {
  neutral: "Required for certification",
  missing: "Required for certification. Not provided.",
  satisfied: "Required for certification. Provided.",
};

interface CertificationFieldTagProps {
  className?: string;
  description?: string;
  /** Saved-state colour. Defaults to `neutral` (no claim). */
  status?: CertFieldStatus;
  /**
   * Id for the screen-reader explanation, so a control can list it in its
   * `aria-describedby` (FormField does).
   */
  descriptionId?: string;
}

/**
 * The CERT seal: a 14px glyph on a label row meaning "required for
 * certification". It shows in Simple and Detailed alike. The sheet or dialog
 * header explains it once (`CertificationLegend`), and the legend appears
 * whenever the sheet holds at least one seal (`data-cert-field`).
 */
export function CertificationFieldTag({
  className,
  description,
  status = "neutral",
  descriptionId,
}: CertificationFieldTagProps) {
  const explanation = description ?? CERT_FIELD_STATUS_DESCRIPTION[status];
  const Glyph = STATUS_GLYPHS[status];
  return (
    // The seal recurs ~10×/form, so the explanation is exposed two ways
    // without adding it to the tab order (that many stops would swamp keyboard
    // nav): an always-on `.sr-only` string for assistive tech, and a pointer
    // tooltip for sighted users. The seal stays a non-interactive span.
    <Tooltip content={explanation}>
      <span
        data-cert-field={status}
        className={cn(
          // `relative` gives the absolutely-positioned `.sr-only` child below a
          // positioned containing block. Without it, the sr-only span resolves its
          // static position against <html>; inside a wide, horizontally-scrolled
          // table its border-box lands far to the right and inflates the document
          // scroll width, producing page-level horizontal scroll on mobile.
          "relative inline-flex shrink-0 items-center",
          STATUS_INK[status],
          className,
        )}
      >
        <Glyph size={CERT_GLYPH_PX} weight="bold" aria-hidden />
        <span id={descriptionId} className="sr-only">{explanation}</span>
      </span>
    </Tooltip>
  );
}

/**
 * The one-line key for the seal, mounted in the sheet and dialog headers
 * (`SlideOverPanel.Header`, `QuickAddDialogShell`). It is hidden by CSS unless
 * the enclosing `[data-cert-scope]` contains a `[data-cert-field]` seal
 * (`src/app/globals.css`), so no form has to opt in and a seal that mounts
 * conditionally brings the legend with it.
 */
export function CertificationLegend({ className }: { className?: string }) {
  return (
    <span
      data-cert-legend=""
      className={cn(
        "items-center gap-6 body-caption text-[var(--color-text-tertiary)]",
        className,
      )}
    >
      <SealIcon
        size={CERT_GLYPH_PX}
        weight="bold"
        aria-hidden
        className="shrink-0 text-[var(--color-text-secondary)]"
      />
      {CERT_FIELD_STATUS_DESCRIPTION.neutral}
    </span>
  );
}
