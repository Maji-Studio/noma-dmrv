/** Delay server-backed list searches until the operator pauses typing. */
export const LIST_SEARCH_DEBOUNCE_MS = 250;

export const LIST_PAGE_SIZE_OPTIONS: readonly number[] = [10, 20, 30, 50];
export const DEFAULT_LIST_PAGE_SIZE: number = LIST_PAGE_SIZE_OPTIONS[0];

/**
 * The storage board shows a wall of bin cards, not table rows, and a facility
 * has a dozen or so bins per lane. It starts at the largest page size so a
 * lane is never split across pages at 10 or 12 bins.
 */
export const STORAGE_BOARD_PAGE_SIZE: number = Math.max(...LIST_PAGE_SIZE_OPTIONS);
