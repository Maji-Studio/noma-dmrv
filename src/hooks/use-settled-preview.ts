"use client";

import { useDebounce } from "./use-debounce";

/** How long a form's inputs rest before a preview asks the server again. */
export const PREVIEW_SETTLE_MS = 350;

/**
 * A form preview's input once it has rested for a moment, so typing does not
 * ask the server on every key. A string key keeps equal inputs equal across
 * renders, so the debounce settles and the query key compares by value.
 * `settling` is true while the shown input is not yet the asked one.
 */
export function useSettledInput<T>(input: T): { settled: T; settling: boolean } {
  const requestKey = JSON.stringify(input ?? null);
  const settledKey = useDebounce(requestKey, PREVIEW_SETTLE_MS);
  return { settled: JSON.parse(settledKey) as T, settling: settledKey !== requestKey };
}

export type SettledPreview<T> = { state: "pending" } | { state: "error" } | { state: "ready"; data: T };

/**
 * Only a settled answer for exactly the current input is shown: while it
 * settles or any check runs (a refetch on focus or after a save elsewhere
 * included), the preview is pending instead of keeping the last answer.
 * Error comes before data: a failed refetch keeps old data, which must not
 * stay claimed.
 */
export function settledPreview<T>(settling: boolean, query: { isFetching: boolean; isError: boolean; data?: T }): SettledPreview<T> {
  if (settling || query.isFetching) return { state: "pending" };
  if (query.isError) return { state: "error" };
  return query.data === undefined ? { state: "pending" } : { state: "ready", data: query.data };
}
