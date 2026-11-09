/**
 * The fix list keeps its place while the operator works through it. A fix
 * opens its record in a new tab; when this tab gets focus back the review is
 * read again, and an item that no longer applies stays in the list as done
 * instead of vanishing. The first item the operator saw fixes the list's order.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import type { ReviewItem } from "./review-items";

export interface FixEntry {
  item: ReviewItem;
  /** No longer open, after it was shown as something to fix. */
  fixed: boolean;
}

/**
 * Open items plus the ones fixed since the step opened, in the order first seen.
 * `holdNew` is true while part of the review is being read again (the build after a fix): what is shown
 * may then be older than the readiness beside it, so it must not introduce an item. A stale refusal
 * would otherwise show as a new row, and be counted as fixed once the fresh read drops it.
 */
export function useFixProgress(items: readonly ReviewItem[], holdNew = false): FixEntry[] {
  const [seen, setSeen] = useState<readonly ReviewItem[]>(items);
  const unseen = holdNew ? [] : items.filter((item) => !seen.some((known) => known.id === item.id));
  // Derived state: the list can only grow here, so this settles in one more render.
  if (unseen.length > 0) setSeen([...seen, ...unseen]);
  const open = new Map(items.map((item) => [item.id, item]));
  return [...seen, ...unseen].map((known) => ({ item: open.get(known.id) ?? known, fixed: !open.has(known.id) }));
}

/**
 * Calls `refresh` every time the tab regains focus once a fix link was used,
 * not only the first time: a repair can take several trips, and a repaired item
 * must not stay open inside the stale window. Returns the handler that marks a
 * fix link as used. A trip counts from the click or from the tab losing focus,
 * so the focus and visibility events of one return refresh once.
 */
export function useRecheckOnReturn(refresh: () => void): () => void {
  const used = useRef(false);
  const away = useRef(false);
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  });
  useEffect(() => {
    const leave = () => {
      if (document.visibilityState === "hidden") away.current = true;
    };
    const recheck = () => {
      if (document.visibilityState !== "visible" || !used.current || !away.current) return;
      away.current = false;
      latest.current();
    };
    const blur = () => {
      away.current = true;
    };
    window.addEventListener("blur", blur);
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", leave);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", leave);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, []);
  return () => {
    used.current = true;
    away.current = true;
  };
}
