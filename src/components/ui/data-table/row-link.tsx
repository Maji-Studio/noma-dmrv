"use client";

import * as React from "react";
import type { ColumnDef, VisibilityState } from "@tanstack/react-table";
import { cn } from "@/lib/utils";

/**
 * The column marked `meta.recordLink` holds the record's code or name. It is
 * the one keyboard and screen-reader target that opens the record, so rows and
 * cards need no interactive role of their own. Only a designated identity
 * column is wrapped: an arbitrary cell (a status badge, readiness) may render its own controls
 * (status history, readiness), and a control inside a control is invalid.
 */
export function rowLinkColumnId(
  columns: ReadonlyArray<{ id: string; columnDef: { meta?: { recordLink?: boolean } } }>,
): string | undefined {
  return columns.find((column) => column.columnDef.meta?.recordLink)?.id;
}

const warnedTables = new Set<string>();

/**
 * Dev-only: a clickable table with no `meta.recordLink` column has no
 * keyboard or screen-reader way to open a record.
 */
export function warnMissingRecordLink(tableLabel: string | undefined) {
  const key = tableLabel ?? "(unlabelled table)";
  if (warnedTables.has(key)) return;
  warnedTables.add(key);
  console.warn(
    `DataTable "${key}" sets onRowClick but no column has meta.recordLink, so rows cannot be opened by keyboard.`,
  );
}

interface RowLinkProps {
  onActivate: () => void;
  /** Deep link that opens this record; renders a real anchor when present. */
  href?: string;
  children: React.ReactNode;
  /** A mark beside the link, outside it so no control nests inside the link. */
  after?: React.ReactNode;
}

const ROW_LINK_CLASSES = cn(
  "inline-flex max-w-full min-w-0 cursor-pointer text-left",
  "underline-offset-4 hover:underline focus-visible:underline",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]",
);

/** A click the browser should handle itself (new tab, new window, download). */
function isModifiedClick(event: React.MouseEvent): boolean {
  return (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

/**
 * The record's identity as the one accessible way to open it.
 *
 * With `href` (the table's deep link, e.g. `?customer=<id>`) this is a real
 * `<a>`: a plain click opens the side sheet in place through `onActivate`
 * without navigating, while modifier and middle clicks fall through so
 * open-in-new-tab loads the deep link. Without one it is a button with link
 * affordance that calls the same handler as a whole-row click.
 */
export function RowLink({ onActivate, href, children, after }: RowLinkProps) {
  const link = href ? (
    <a
      href={href}
      data-row-link=""
      onClick={(event) => {
        // The row's own click handler would activate a second time, and a
        // modifier click must not also open the sheet behind the new tab.
        event.stopPropagation();
        if (isModifiedClick(event)) return;
        event.preventDefault();
        onActivate();
      }}
      className={ROW_LINK_CLASSES}
    >
      {children}
    </a>
  ) : (
    <button
      type="button"
      data-row-link=""
      onClick={(event) => {
        event.stopPropagation();
        onActivate();
      }}
      className={ROW_LINK_CLASSES}
    >
      {children}
    </button>
  );
  if (!after) return link;
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-8">
      {link}
      {after}
    </span>
  );
}

/** Visibility entries that pin every record-link column on. */
export function recordLinkVisibility<TData, TValue>(
  columns: ColumnDef<TData, TValue>[],
): VisibilityState {
  const visible: VisibilityState = {};
  for (const column of columns) {
    if (!column.meta?.recordLink) continue;
    const id =
      column.id ?? ("accessorKey" in column ? String(column.accessorKey) : undefined);
    if (id) visible[id] = true;
  }
  return visible;
}

/** Visibility entries for the columns that start hidden (`meta.hiddenByDefault`). */
export function defaultColumnVisibility<TData, TValue>(
  columns: ColumnDef<TData, TValue>[],
): VisibilityState {
  const hidden: VisibilityState = {};
  for (const column of columns) {
    if (!column.meta?.hiddenByDefault) continue;
    const id =
      column.id ?? ("accessorKey" in column ? String(column.accessorKey) : undefined);
    if (id) hidden[id] = false;
  }
  return hidden;
}
