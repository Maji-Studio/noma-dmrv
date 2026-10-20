/**
 * ExplanationInfo — the one (i) that opens an explanation: a composition
 * table, a calculation, the batches behind a figure, a formula with its
 * provenance.
 *
 * `<ExplanationInfo title="Dry biochar" hint="One sentence definition.">{tables}</ExplanationInfo>`
 *
 * Explanation never sits inline; it opens from this button beside the figure
 * or caption it explains. A mouse hover opens it on desktop; a tap, click,
 * Enter or Space opens it everywhere else. Escape, an outside press, the close
 * button or a second press closes it, so the panel never traps the field being
 * edited. Built on `Popover`, not the Base UI Tooltip, which closes on the tap
 * that opens it.
 *
 * One (i) per block. When the block also has a one-sentence definition, pass it
 * as `hint`: it leads the panel and no second (i) is drawn beside this one.
 *
 * The trigger is a `span` with `role="button"`, not a native button: a native
 * button inside the `<fieldset disabled>` of a read-only form is disabled, and a
 * locked record must still open its explanations. Enter and Space work as on a
 * button. It looks like `InfoHint` (same glyph, size, colour) and keeps its
 * 24px hit area, the WCAG 2.5.8 floor the design system sanctions for inline
 * glyphs. `data-presentation-control` keeps the sheet's unsaved-change
 * heuristic from reading a press on it as an edit.
 */
"use client";

import type { ReactNode } from "react";
import { InfoIcon } from "@phosphor-icons/react/dist/ssr";
import { Popover } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const ICON_PX = 14;
// Panels hold tables, so they may be wider than a plain popover on desktop.
// Phones keep a 16px gutter either side.
const PANEL_CLASS = "w-[min(420px,calc(100vw-32px))]";

interface ExplanationInfoProps {
  /** What is explained ("Dry biochar", "Yield"). Heads the panel and names the button. */
  title: string;
  /** One sentence defining the block. Leads the panel when given. */
  hint?: ReactNode;
  /** Tables, ledgers and arithmetic. Mounts only while the panel is open. */
  children?: ReactNode;
  className?: string;
}

function ExplanationInfo({ title, hint, children, className }: ExplanationInfoProps) {
  return (
    <Popover
      openOnHover
      nativeTrigger={false}
      title={title}
      className={PANEL_CLASS}
      trigger={(
        <span
          role="button"
          tabIndex={0}
          data-presentation-control
          data-explanation-info
          aria-label={`About ${title}`}
          className={cn(
            "inline-flex min-h-24 min-w-24 shrink-0 items-center justify-center align-middle",
            "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]",
            "transition-colors cursor-help",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)] focus-visible:ring-offset-1",
            className,
          )}
        >
          <InfoIcon size={ICON_PX} weight="bold" aria-hidden />
        </span>
      )}
    >
      <div className="flex flex-col gap-12">
        {hint && <p className="body-caption text-[var(--color-text-secondary)]">{hint}</p>}
        {children}
      </div>
    </Popover>
  );
}

export { ExplanationInfo };
export type { ExplanationInfoProps };
