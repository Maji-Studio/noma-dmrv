/**
 * Tooltip — popover for collapsing verbose helper text
 * Built on Base UI Tooltip.
 *
 * Two layers:
 *  - `Tooltip`     low-level hover/focus wrapper: `<Tooltip content={…}>{trigger}</Tooltip>`
 *  - `InfoHint`    info ⓘ toggletip (tap, click, hover, focus), for sitting next to a label
 *
 * Self-contained: each instance carries its own Provider, so no app-root
 * provider is required.
 */
"use client";

import * as React from "react";
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { InfoIcon } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import {
  applyTooltipOpenChange,
  pressToggletip,
  TOGGLETIP_CLOSED,
  type ToggletipState,
} from "./toggletip-state";

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

/** The positioned popup both layers share. */
function TooltipPopup({
  side,
  className,
  children,
}: {
  side: Side;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <BaseTooltip.Portal>
      {/* Portaled transient controls must stay above sheets and dialogs. */}
      <BaseTooltip.Positioner
        side={side}
        sideOffset={SIDE_OFFSET_PX}
        className="z-[var(--z-layer-popover)]"
      >
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
          {children}
        </BaseTooltip.Popup>
      </BaseTooltip.Positioner>
    </BaseTooltip.Portal>
  );
}

/**
 * Low-level tooltip wrapper. The child is used as the trigger; if it is a
 * non-interactive element, wrap an interactive one (button/link) yourself.
 * Hover and focus only: for help an operator may need on a touch screen, use
 * `InfoHint`, which also opens on a tap.
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
        <TooltipPopup side={side} className={className}>
          {content}
        </TooltipPopup>
      </BaseTooltip.Root>
    </BaseTooltip.Provider>
  );
}

interface InfoHintProps {
  /** The explanation. Plain text or inline markup, no controls or links. */
  children: React.ReactNode;
  /** Accessible label for the trigger button. */
  label?: string;
  side?: Side;
  /** Icon size in px (default 14). */
  size?: number;
  className?: string;
  /**
   * Id of an element that already carries the same explanation for assistive
   * tech (FormField's screen-reader copy). The trigger points at it instead
   * of rendering a second hidden copy.
   */
  descriptionId?: string;
}

/**
 * Info ⓘ toggletip beside a label. The explanation opens on a tap or click, on
 * hover, and on keyboard focus; Escape, an outside press or a second press
 * closes it. The trigger is its own 24px button: keep it outside any `<label>`,
 * or a tap on it would also focus or toggle the labelled control.
 *
 * Screen readers get the explanation as the button's description
 * (`aria-describedby`), so it is announced on focus without opening anything.
 */
function InfoHint({
  children,
  label = "More information",
  side = "top",
  size = 14,
  className,
  descriptionId,
}: InfoHintProps) {
  const ownDescriptionId = React.useId();
  const [state, setState] = React.useState<ToggletipState>(TOGGLETIP_CLOSED);

  return (
    <>
      <BaseTooltip.Provider delay={OPEN_DELAY_MS} closeDelay={CLOSE_DELAY_MS}>
        <BaseTooltip.Root
          open={state.open}
          onOpenChange={(next, details) =>
            setState((current) => applyTooltipOpenChange(current, next, details.reason))
          }
        >
          <BaseTooltip.Trigger
            render={
              <button
                type="button"
                aria-label={label}
                aria-describedby={descriptionId ?? ownDescriptionId}
                data-toggletip-trigger=""
                onClick={() => setState(pressToggletip)}
                className={cn(
                  "inline-flex shrink-0 items-center justify-center align-middle",
                  // WCAG 2.5.8 floor: the hit area stays 24px however small the glyph
                  // is, so the hint is reachable on touch.
                  "min-w-24 min-h-24",
                  "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]",
                  "transition-colors cursor-help",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)] focus-visible:ring-offset-1",
                  className
                )}
              />
            }
          >
            <InfoIcon size={size} weight="bold" aria-hidden />
          </BaseTooltip.Trigger>
          <TooltipPopup side={side}>{children}</TooltipPopup>
        </BaseTooltip.Root>
      </BaseTooltip.Provider>
      {descriptionId == null && (
        <span id={ownDescriptionId} hidden>
          {children}
        </span>
      )}
    </>
  );
}

export { Tooltip, InfoHint };
export type { TooltipProps, InfoHintProps };
