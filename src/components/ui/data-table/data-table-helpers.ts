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
    /**
     * The record's identity column (code or name). In a table with
     * `onRowClick` its cell renders as the record link, and it cannot be
     * hidden. Never mark a column whose cell renders its own controls.
     */
    recordLink?: boolean;
    /**
     * Only with `recordLink`: a mark rendered right before the record link,
     * outside it, so no control nests inside the link. Return null for none.
     */
    recordLinkBefore?: (row: TData) => React.ReactNode;
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

/**
 * React events bubble through portals, so a press inside a popover or menu
 * opened from a row reaches the row's handlers although its target sits
 * outside the row's DOM. Such presses never activate the row.
 */
function isFromPortal(event: React.SyntheticEvent<HTMLElement>): boolean {
  return !event.currentTarget.contains(event.target as Node);
}

/**
 * Pointer-only row click. Keyboard and screen-reader users activate the
 * record link (`meta.recordLink`) instead (see `row-link.tsx`); a nested control keeps its own
 * press.
 */
export function handleRowActivationClick(
  event: React.MouseEvent<HTMLElement>,
  activate: () => void,
) {
  if (isFromPortal(event)) return;
  const interactive = (event.target as HTMLElement).closest(
    INTERACTIVE_ROW_CONTROL_SELECTOR,
  );
  if (interactive && interactive !== event.currentTarget) return;
  activate();
}
