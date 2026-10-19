/**
 * The line row's column grid, shared by the row header and the open row (its
 * description, sources table and comment), so the table's Amount and ⋯ stand
 * under the row's Total and ⋯ and the open row reads as one grid.
 */
import { cn } from "@/lib/utils";

/** Wide screens: Line | State | Sources | Total | actions. */
export const ROW_COLUMNS = "md:grid-cols-[minmax(0,1.25fr)_148px_minmax(0,1fr)_minmax(120px,168px)_44px] md:gap-x-16";

/** Phones: content | figure | ⋯, the row header and the open row alike, so figures and ⋯ line up down the row. */
export const PHONE_COLUMNS = "grid-cols-[minmax(0,1fr)_auto_32px] gap-x-12";

/**
 * Phones: the 44px ⋯ sits in a 32px column and reaches into the row padding,
 * so its glyph ends on the content edge. Wide screens give it a full column.
 */
export const MENU_PULL = "-mr-12 md:mr-0";

/** A row of the open line: phones Source | Amount | ⋯ with details under them; wide, the row's five columns. */
export const TABLE_ROW = cn("grid items-baseline px-16", PHONE_COLUMNS, ROW_COLUMNS);

/** Text in the open row starts where the line name does: after the row caret (14px) and its gap (6px). */
export const NAME_INSET = "pl-20";

/**
 * A 44px touch target around a compact inline control without growing the row:
 * a hit area centred on the control, as on the certification status badge.
 */
export const TOUCH_TARGET = cn(
  "relative before:absolute before:left-1/2 before:top-1/2 before:-translate-x-1/2 before:-translate-y-1/2",
  "before:h-44 before:w-full before:min-w-44 before:content-['']",
);
