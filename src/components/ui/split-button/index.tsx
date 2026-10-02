/**
 * SplitButton — one primary action plus an attached ▾ trigger whose menu
 * holds secondary ways to do the same job (e.g. "New X" + "Import X").
 *
 * The two halves share one border and radius and are separated by a divider
 * so they read as a single control. The menu is the shared DropdownMenu
 * (Base UI), so Enter/Space/ArrowDown open it, Escape closes it and focus
 * returns to the trigger.
 */
"use client";

import * as React from "react";
import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { DropdownMenu } from "@/components/ui/dropdown-menu";

interface SplitButtonItem {
  label: string;
  onSelect: () => void;
  icon?: React.ReactNode;
}

interface SplitButtonProps {
  /** Primary action content (icon + label). */
  children: React.ReactNode;
  onClick: () => void;
  /** Accessible name for the ▾ trigger, e.g. `More ways to add a feedstock type`. */
  menuLabel: string;
  items: SplitButtonItem[];
  variant?: "primary" | "default";
}

function SplitButton({
  children,
  onClick,
  menuLabel,
  items,
  variant = "primary",
}: SplitButtonProps) {
  return (
    <div className="inline-flex items-stretch">
      <Button variant={variant} onClick={onClick}>
        {children}
      </Button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          render={
            <Button
              variant={variant}
              aria-label={menuLabel}
              className="min-w-44 px-0 border-l border-l-[var(--paper)]"
            />
          }
        >
          <CaretDownIcon size={16} weight="bold" aria-hidden />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content>
          {items.map((item) => (
            <DropdownMenu.Item key={item.label} onClick={item.onSelect}>
              {item.icon}
              {item.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  );
}

export { SplitButton };
export type { SplitButtonProps, SplitButtonItem };
