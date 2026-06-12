/**
 * DropdownMenu — light overflow/action menu built on Base UI Menu.
 *
 * Compound API mirroring SlideOverPanel:
 *   <DropdownMenu.Root>
 *     <DropdownMenu.Trigger render={<Button … />} />
 *     <DropdownMenu.Content>
 *       <DropdownMenu.Item onClick={…}>Edit</DropdownMenu.Item>
 *       <DropdownMenu.Item destructive onClick={…}>Delete</DropdownMenu.Item>
 *     </DropdownMenu.Content>
 *   </DropdownMenu.Root>
 */
"use client";

import * as React from "react";
import { Menu } from "@base-ui/react/menu";
import { cn } from "@/lib/utils";

const SIDE_OFFSET_PX = 4;

/* -------------------------------------------------------------------------------------------------
 * Root / Trigger — thin re-exports
 * -----------------------------------------------------------------------------------------------*/

const Root = Menu.Root;
const Trigger = Menu.Trigger;

/* -------------------------------------------------------------------------------------------------
 * Content — portal + positioner + popup
 * -----------------------------------------------------------------------------------------------*/

interface DropdownMenuContentProps {
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  className?: string;
}

function Content({
  children,
  side = "bottom",
  align = "end",
  className,
}: DropdownMenuContentProps) {
  return (
    <Menu.Portal>
      {/* z-60 keeps menus above modals/slide-overs (z-50) — same stacking
          rationale as the tooltip primitive. */}
      <Menu.Positioner
        side={side}
        align={align}
        sideOffset={SIDE_OFFSET_PX}
        className="z-[60]"
      >
        <Menu.Popup
          className={cn(
            "min-w-[160px] py-4",
            // Floating chrome floats on border alone (Maji DS: no drop
            // shadows) — full-ink hairline does the elevation work.
            "bg-[var(--paper)] [border:var(--hair)]",
            "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
            "transition-opacity duration-150",
            "outline-none",
            className
          )}
        >
          {children}
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  );
}
Content.displayName = "DropdownMenu.Content";

/* -------------------------------------------------------------------------------------------------
 * Item
 * -----------------------------------------------------------------------------------------------*/

interface DropdownMenuItemProps {
  children: React.ReactNode;
  /** Red text + red-tint highlight for irreversible actions. */
  destructive?: boolean;
  onClick?: (event: React.MouseEvent) => void;
  /** Base UI render prop — pass a Link to make the item navigate. */
  render?: React.ReactElement;
  className?: string;
  disabled?: boolean;
}

function Item({
  children,
  destructive = false,
  onClick,
  render,
  className,
  disabled,
}: DropdownMenuItemProps) {
  return (
    <Menu.Item
      onClick={onClick}
      render={render}
      disabled={disabled}
      className={cn(
        "flex w-full cursor-pointer items-center gap-8 px-12 py-8",
        "body-small text-left outline-none",
        "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
        destructive
          ? "text-[var(--st-bad)] data-[highlighted]:bg-[var(--st-bad-bg)]"
          : "text-[var(--color-text-primary)] data-[highlighted]:bg-[var(--color-background-medium)]",
        className
      )}
    >
      {children}
    </Menu.Item>
  );
}
Item.displayName = "DropdownMenu.Item";

/* -------------------------------------------------------------------------------------------------
 * Separator
 * -----------------------------------------------------------------------------------------------*/

function Separator({ className }: { className?: string }) {
  return (
    <Menu.Separator
      className={cn("my-4 h-px bg-[var(--color-border-secondary)]", className)}
    />
  );
}
Separator.displayName = "DropdownMenu.Separator";

/* -------------------------------------------------------------------------------------------------
 * Export
 * -----------------------------------------------------------------------------------------------*/

export const DropdownMenu = {
  Root,
  Trigger,
  Content,
  Item,
  Separator,
};

export type { DropdownMenuContentProps, DropdownMenuItemProps };
