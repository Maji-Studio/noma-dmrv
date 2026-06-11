"use client";

/**
 * Map control stack (concept: vertical stack of 36px square buttons, hairline
 * border, hover inverts to ink-on-paper). Shared by the PositionPicker preview
 * (+ − SAT) and the Carbon Viewer (+ − FIT SAT).
 */

import { cn } from "@/lib/utils";

const CONTROL_BUTTON_CLASS =
  "flex size-36 items-center justify-center label-button uppercase " +
  "bg-[var(--color-background-white)] text-[var(--clr-dark-purple)] " +
  "border-b border-[var(--clr-dark-purple-30)] last:border-b-0 " +
  "hover:bg-[var(--clr-dark-purple)] hover:text-[var(--color-background-white)] " +
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-interaction)] " +
  "cursor-pointer transition-colors";

export interface MapControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  /** Optional fit-to-bounds button (Carbon Viewer). */
  onFit?: () => void;
  satOn: boolean;
  onToggleSat: () => void;
  className?: string;
}

export function MapControls({
  onZoomIn,
  onZoomOut,
  onFit,
  satOn,
  onToggleSat,
  className,
}: MapControlsProps) {
  return (
    <div
      className={cn(
        "absolute left-8 top-8 z-10 flex flex-col border border-[var(--clr-dark-purple-30)] shadow-[0_1px_4px_var(--color-black-10)]",
        className
      )}
    >
      <button type="button" aria-label="Zoom in" className={CONTROL_BUTTON_CLASS} onClick={onZoomIn}>
        +
      </button>
      <button type="button" aria-label="Zoom out" className={CONTROL_BUTTON_CLASS} onClick={onZoomOut}>
        −
      </button>
      {onFit ? (
        <button
          type="button"
          aria-label="Fit map to markers"
          className={CONTROL_BUTTON_CLASS}
          onClick={onFit}
        >
          FIT
        </button>
      ) : null}
      <button
        type="button"
        aria-label="Toggle satellite imagery"
        aria-pressed={satOn}
        className={cn(
          CONTROL_BUTTON_CLASS,
          satOn && "bg-[var(--clr-dark-purple)] text-[var(--color-background-white)]"
        )}
        onClick={onToggleSat}
      >
        SAT
      </button>
    </div>
  );
}
