"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Column ids that never carry the record's identity: selection checkboxes and
 * the overflow menu.
 */
const STRUCTURAL_COLUMN_IDS: ReadonlySet<string> = new Set(["select", "actions"]);

/**
 * The first data column of a clickable table holds the record's code or name.
 * It is the one keyboard and screen-reader target that opens the record, so
 * rows and cards need no interactive role of their own.
 */
export function rowLinkColumnId(
  columns: ReadonlyArray<{ id: string }>,
): string | undefined {
  return columns.find((column) => !STRUCTURAL_COLUMN_IDS.has(column.id))?.id;
}

interface RowLinkProps {
  onActivate: () => void;
  children: React.ReactNode;
}

/**
 * The record's name as a link-styled control. Tables open a side sheet rather
 * than navigating, so this is a button with link affordance (underline on
 * hover and focus) that calls the same handler as a whole-row click.
 */
export function RowLink({ onActivate, children }: RowLinkProps) {
  return (
    <button
      type="button"
      data-row-link=""
      onClick={(event) => {
        // The row's own click handler would activate a second time.
        event.stopPropagation();
        onActivate();
      }}
      className={cn(
        "inline-flex max-w-full min-w-0 cursor-pointer text-left",
        "underline-offset-4 hover:underline focus-visible:underline",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]",
      )}
    >
      {children}
    </button>
  );
}
