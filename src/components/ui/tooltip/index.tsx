/**
 * Tooltip — hover/focus popover for collapsing verbose helper text
 * Built on Base UI Tooltip.
 *
 * Two layers:
 *  - `Tooltip`     low-level wrapper: `<Tooltip content={…}>{trigger}</Tooltip>`
 *  - `InfoHint`    info ⓘ icon trigger + tooltip, for sitting next to a label
 *
 * Self-contained: each instance carries its own Provider, so no app-root
 * provider is required.
 */
"use client";

import * as React from "react";
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { InfoIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

// Open/close delays (ms) — snappy enough to feel responsive, slow enough to
// avoid flicker when the pointer crosses an icon.
const OPEN_DELAY_MS = 160;
const CLOSE_DELAY_MS = 80;
const SIDE_OFFSET_PX = 6;

type Side = "top" | "bottom" | "left" | "right";

interface TooltipProps {
  /** Tooltip body. Keep it short — a sentence or two. */
  content: React.ReactNode;
  /** The element that opens the tooltip on hover/focus. Must be focusable. */
  children: React.ReactNode;
  side?: Side;
  /** Override the popup max width (default 280px). */
  className?: string;
}

/**
 * Low-level tooltip wrapper. The child is used as the trigger; if it is a
 * non-interactive element, wrap an interactive one (button/link) yourself.
 */
function Tooltip({ content, children, side = "top", className }: TooltipProps) {
  return (
    <BaseTooltip.Provider delay={OPEN_DELAY_MS} closeDelay={CLOSE_DELAY_MS}>
      <BaseTooltip.Root>
        <BaseTooltip.Trigger
          render={
            React.isValidElement(children) ? (children as React.ReactElement) : <span>{children}</span>
          }
        />
        <BaseTooltip.Portal>
          {/* z-60 keeps tooltips above modals/slide-overs (z-50), which portal
              to the same <body> stacking context. Without it the popup opens
              on hover but paints behind the dialog and is never visible. */}
          <BaseTooltip.Positioner side={side} sideOffset={SIDE_OFFSET_PX} className="z-[60]">
            <BaseTooltip.Popup
              className={cn(
                "max-w-[280px] px-12 py-8",
                "bg-[var(--color-background-dark-strong)] text-[var(--color-background-white)]",
                "border border-[var(--color-border-primary)]",
                "shadow-[0_4px_16px_var(--color-black-10)]",
                "body-caption leading-relaxed",
                "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
                "transition-opacity duration-150",
                className
              )}
            >
              <BaseTooltip.Arrow className="text-[var(--color-background-dark-strong)]" />
              {content}
            </BaseTooltip.Popup>
          </BaseTooltip.Positioner>
        </BaseTooltip.Portal>
      </BaseTooltip.Root>
    </BaseTooltip.Provider>
  );
}

interface InfoHintProps {
  /** The explanatory text to show on hover/focus. */
  children: React.ReactNode;
  /** Accessible label for the trigger button. */
  label?: string;
  side?: Side;
  /** Icon size in px (default 14). */
  size?: number;
  className?: string;
}

/**
 * Info ⓘ icon that reveals helper text on hover/focus — sits inline next to a
 * SectionLabel or field label so the prose no longer occupies layout space.
 */
function InfoHint({
  children,
  label = "More information",
  side = "top",
  size = 14,
  className,
}: InfoHintProps) {
  return (
    <Tooltip content={children} side={side}>
      <button
        type="button"
        aria-label={label}
        className={cn(
          "inline-flex shrink-0 items-center justify-center align-middle",
          "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]",
          "transition-colors cursor-help",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)] focus-visible:ring-offset-1",
          className
        )}
      >
        <InfoIcon size={size} weight="bold" />
      </button>
    </Tooltip>
  );
}

export { Tooltip, InfoHint };
export type { TooltipProps, InfoHintProps };
