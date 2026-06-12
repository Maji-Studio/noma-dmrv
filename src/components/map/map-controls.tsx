"use client";

/**
 * Map control stack (concept: vertical stack of 36px square buttons, hairline
 * border, hover inverts to ink-on-paper). Shared by the PositionPicker preview
 * (+ − SAT) and the Carbon Viewer (+ − FIT SAT).
 */

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// Overrides on top of Button (variant="noOutline" size="icon"): 36px square,
// ink-on-paper that inverts on hover, hairline divider between stacked buttons.
const CONTROL_BUTTON_CLASS =
  "h-36 w-36 " +
  "bg-[var(--color-background-white)] text-[var(--clr-dark-purple)] " +
  "border-b border-[var(--clr-dark-purple-30)] last:border-b-0 " +
  "hover:bg-[var(--clr-dark-purple)] hover:text-[var(--color-background-white)] " +
  "focus-visible:ring-1 focus-visible:ring-[var(--color-interaction)]";

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
      <Button
        variant="noOutline"
        size="icon"
        aria-label="Zoom in"
        className={CONTROL_BUTTON_CLASS}
        onClick={onZoomIn}
      >
        +
      </Button>
      <Button
        variant="noOutline"
        size="icon"
        aria-label="Zoom out"
        className={CONTROL_BUTTON_CLASS}
        onClick={onZoomOut}
      >
        −
      </Button>
      {onFit ? (
        <Button
          variant="noOutline"
          size="icon"
          aria-label="Fit map to markers"
          className={CONTROL_BUTTON_CLASS}
          onClick={onFit}
        >
          FIT
        </Button>
      ) : null}
      <Button
        variant="noOutline"
        size="icon"
        aria-label="Toggle satellite imagery"
        aria-pressed={satOn}
        className={cn(
          CONTROL_BUTTON_CLASS,
          satOn && "bg-[var(--clr-dark-purple)] text-[var(--color-background-white)]"
        )}
        onClick={onToggleSat}
      >
        SAT
      </Button>
    </div>
  );
}
