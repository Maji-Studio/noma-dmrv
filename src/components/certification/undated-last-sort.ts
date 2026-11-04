import type { Row, SortingState } from "@tanstack/react-table";

/** Whether the table is currently sorting this column descending. */
export function isSortedDescending(sorting: SortingState, columnId: string): boolean {
  return sorting.some((entry) => entry.id === columnId && entry.desc);
}

/**
 * Chronological comparator that keeps undated rows after every dated row in
 * BOTH directions. TanStack flips a sortingFn's result for descending sorts, so
 * undated rows are ranked first here when descending, and the flip puts them
 * last. The accessor stays the shown text, so search keeps matching it.
 */
export function undatedLastSortingFn<T>(
  timestampOf: (original: T) => number | null,
  descending: boolean,
) {
  return (a: Row<T>, b: Row<T>): number => {
    const left = timestampOf(a.original);
    const right = timestampOf(b.original);
    if (left === null && right === null) return 0;
    if (left === null) return descending ? -1 : 1;
    if (right === null) return descending ? 1 : -1;
    return left - right;
  };
}
