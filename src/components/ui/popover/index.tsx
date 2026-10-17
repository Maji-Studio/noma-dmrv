/**
 * Popover — a small, titled panel opened by a press on its trigger.
 * Built on Base UI Popover.
 *
 * `<Popover trigger={<button …/>} title="Status history">{body}</Popover>`
 *
 * Unlike `InfoHint` (a tooltip that must also open on a tap), a popover opens
 * on press by default, so Base UI's own trigger handling covers click, tap,
 * Enter and Space. `openOnHover` adds mouse hover on top: Base UI ignores touch
 * pointers for hover, so a tap still toggles by press, and a press on a
 * hover-opened popover keeps it open. No open state is kept here, and there is no manual toggle that a
 * "trigger-press" close request could undo. Escape, an outside press, the
 * close button or a second press on the trigger closes it. The body mounts
 * only while open, so a query inside it fetches on open.
 *
 * Self-contained: the popup is portaled above sheets and dialogs. A clickable
 * table row or card it sits in ignores presses inside the portal
 * (`handleRowActivationClick`).
 */
"use client";

import * as React from "react";
import { Popover as BasePopover } from "@base-ui/react/popover";
import { XIcon } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";

const SIDE_OFFSET_PX = 6;
// Keep a 16px gutter to the viewport edge on phones.
const COLLISION_PADDING_PX = 16;
const CLOSE_ICON_SIZE = 16;
// Hover timing: a short open delay avoids popping while the pointer crosses a
// table; a close delay lets it travel from the trigger into the popup.
const HOVER_OPEN_DELAY_MS = 200;
const HOVER_CLOSE_DELAY_MS = 150;

type Side = "top" | "bottom" | "left" | "right";
type Align = "start" | "center" | "end";

interface PopoverProps {
  /**
   * The element that opens the popover. Render a real `<button type="button">`
   * with an accessible name; Base UI wires press handling and `aria-expanded`
   * onto it.
   */
  trigger: React.ReactElement;
  /** Heading of the panel, and its accessible name. */
  title: string;
  children: React.ReactNode;
  side?: Side;
  align?: Align;
  /** Extra classes for the popup, e.g. a different width. */
  className?: string;
  /** Also open while a mouse hovers the trigger (desktop). Default: press only. */
  openOnHover?: boolean;
}

function Popover({
  trigger,
  title,
  children,
  side = "bottom",
  align = "start",
  className,
  openOnHover = false,
}: PopoverProps) {
  return (
    <BasePopover.Root>
      <BasePopover.Trigger
        render={trigger}
        openOnHover={openOnHover}
        delay={HOVER_OPEN_DELAY_MS}
        closeDelay={HOVER_CLOSE_DELAY_MS}
      />
      <BasePopover.Portal>
        {/* Portaled transient controls must stay above sheets and dialogs. */}
        <BasePopover.Positioner
          side={side}
          align={align}
          sideOffset={SIDE_OFFSET_PX}
          collisionPadding={COLLISION_PADDING_PX}
          className="z-[var(--z-layer-popover)]"
        >
          <BasePopover.Popup
            className={cn(
              "flex flex-col",
              "w-[min(320px,calc(100vw-32px))] max-h-[min(420px,var(--available-height))]",
              // Floating chrome floats on border alone (Maji DS: no drop
              // shadows); the full-ink hairline does the elevation work.
              "bg-[var(--paper)] [border:var(--hair)]",
              "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
              "transition-opacity duration-150",
              "outline-none",
              className
            )}
          >
            <div className="flex items-center justify-between gap-8 border-b border-[var(--color-border-secondary)] py-4 pl-12 pr-4">
              <BasePopover.Title className="body-small font-medium text-[var(--color-text-primary)]">
                {title}
              </BasePopover.Title>
              <BasePopover.Close
                aria-label="Close"
                className={cn(
                  "inline-flex size-44 shrink-0 items-center justify-center",
                  "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]",
                  "hover:bg-[var(--color-surface-medium)] transition-colors cursor-pointer",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-interaction)]"
                )}
              >
                <XIcon size={CLOSE_ICON_SIZE} weight="bold" aria-hidden />
              </BasePopover.Close>
            </div>
            <div className="min-h-0 overflow-y-auto p-12">{children}</div>
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}

export { Popover };
export type { PopoverProps };
