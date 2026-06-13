/**
 * RowActionsMenu — the single row-action pattern for table/card lists
 * (visual design plan, Phase 2 "quiet tables").
 *
 * A quiet ⋮ icon button that opens an overflow menu. Replaces the inline
 * Edit/Delete button pairs and View links that previously varied per list.
 * Row click remains the way to open the detail sheet; the menu carries the
 * explicit verbs (Edit, Delete, Open details, …).
 */
"use client";

import * as React from "react";
import Link from "next/link";
import { DotsThreeVertical } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { DropdownMenu } from "@/components/ui/dropdown-menu";

interface RowAction {
  label: string;
  onSelect?: () => void;
  /** Navigate instead of invoking a handler — renders the item as a Link. */
  href?: string;
  /** Red treatment for irreversible actions (Delete, Archive). */
  destructive?: boolean;
  icon?: React.ReactNode;
  disabled?: boolean;
}

interface RowActionsMenuProps {
  /** Accessible name for the trigger, e.g. `Actions for FAC-001`. */
  label: string;
  actions: RowAction[];
  className?: string;
}

function RowActionsMenu({ label, actions, className }: RowActionsMenuProps) {
  return (
    <div
      className={className}
      // Keep row-click (open detail sheet) from firing for any click inside
      // the trigger cell, including the portal-less trigger button itself.
      onClick={(e) => e.stopPropagation()}
    >
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          render={
            <Button
              variant="noOutline"
              size="icon"
              aria-label={label}
              className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
            />
          }
        >
          <DotsThreeVertical size={20} weight="bold" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content>
          {actions.map((action) =>
            action.href ? (
              <DropdownMenu.Item
                key={action.label}
                destructive={action.destructive}
                disabled={action.disabled}
                render={<Link href={action.href} />}
              >
                {action.icon}
                {action.label}
              </DropdownMenu.Item>
            ) : (
              <DropdownMenu.Item
                key={action.label}
                destructive={action.destructive}
                disabled={action.disabled}
                onClick={action.onSelect}
              >
                {action.icon}
                {action.label}
              </DropdownMenu.Item>
            )
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  );
}
RowActionsMenu.displayName = "RowActionsMenu";

export { RowActionsMenu };
export type { RowAction, RowActionsMenuProps };
