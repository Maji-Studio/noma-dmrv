import type { SankeyExit } from "@/lib/chain-of-custody/sankey";

/** Where the column bars start and the tallest bar's height, in viewBox units. */
export const FLOW_TOP = 84;
export const FLOW_MAX_H = 230;
/** Gap between the bottom of the tallest bar and the first exit row. */
export const EXIT_TOP_GAP = 24;
/** Stub, label line and value line stacked, so a second exit never lands on the first. */
export const EXIT_ROW_H = 68;
/** Space kept below the last exit row so its value line is never clipped. */
export const EXIT_BOTTOM_PADDING = 26;
/** Exit rows always reserved, so a sparse batch keeps the same canvas as a full one. */
export const MIN_EXIT_ROWS = 2;

/** Top of the first exit row, shared by every column. */
export const EXIT_AREA_TOP = FLOW_TOP + FLOW_MAX_H + EXIT_TOP_GAP;

/** Top of one exit row inside its column. */
export function exitRowTop(exitIndex: number): number {
  return EXIT_AREA_TOP + exitIndex * EXIT_ROW_H;
}

/** Canvas height that fits the most crowded column's exit rows. */
export function sankeyViewHeight(exits: readonly Pick<SankeyExit, "fromColumn">[]): number {
  const perColumn = new Map<string, number>();
  for (const exit of exits) {
    perColumn.set(exit.fromColumn, (perColumn.get(exit.fromColumn) ?? 0) + 1);
  }
  const rows = Math.max(MIN_EXIT_ROWS, ...perColumn.values());
  return EXIT_AREA_TOP + rows * EXIT_ROW_H + EXIT_BOTTOM_PADDING;
}
