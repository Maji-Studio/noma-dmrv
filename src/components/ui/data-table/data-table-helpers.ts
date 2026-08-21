import type * as React from "react";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    /** Keep the cell on one line (record codes, dates). */
    nowrap?: boolean;
    /**
     * Pin the column to the right edge of the horizontal scrollport so it
     * stays visible when the table overflows (actions, status). The pinned
     * cell carries a leading hairline as the in-region overflow signal.
     */
    stickyEnd?: boolean;
  }
}

// Solid backgrounds (not the alpha washes) because pinned cells scroll over
// their neighbours; the hairline marks where the data region is cut off.
export const STICKY_END_CELL_CLASSES =
  "sticky right-0 z-10 bg-[var(--panel-bg)] [border-left:var(--hair-3)] group-hover/row:bg-[var(--row-hover-bg-solid)]";
export const STICKY_END_HEADER_CLASSES =
  "sticky right-0 z-10 bg-[var(--panel-head-bg-solid)] [border-left:var(--hair-3)]";
const INTERACTIVE_ROW_CONTROL_SELECTOR =
  'button, a, label, input, textarea, select, [role="button"], [tabindex]:not([tabindex="-1"])';

/**
 * Derive a human-readable label for a column, used by the mobile card view
 * where each cell is shown as a label/value pair. Prefers a string `header`;
 * falls back to a humanized column id. Returns "" for structural columns
 * (selection / actions) so their cell renders without a label.
 */
export function columnLabel(column: {
  id: string;
  columnDef: { header?: unknown };
}): string {
  const header = column.columnDef.header;
  if (column.id === "select" || column.id === "actions") return "";
  if (typeof header === "string") return header;
  return column.id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

/** Activate a clickable row or card with Enter/Space. */
export function handleRowActivationKeyDown(
  event: React.KeyboardEvent<HTMLElement>,
  activate: () => void,
) {
  if (event.key !== "Enter" && event.key !== " ") return;
  const interactive = (event.target as HTMLElement).closest(
    INTERACTIVE_ROW_CONTROL_SELECTOR,
  );
  if (interactive && interactive !== event.currentTarget) return;
  event.preventDefault();
  activate();
}

/** Activate a clickable row or card unless a nested control was clicked. */
export function handleRowActivationClick(
  event: React.MouseEvent<HTMLElement>,
  activate: () => void,
) {
  const interactive = (event.target as HTMLElement).closest(
    INTERACTIVE_ROW_CONTROL_SELECTOR,
  );
  if (interactive && interactive !== event.currentTarget) return;
  activate();
}
