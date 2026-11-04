"use client";

import { useState, useSyncExternalStore } from "react";

/**
 * Busy state for an action that ends in a full page navigation (`window.location`
 * assign or replace). `isPending` and `isSubmitting` end when the request returns,
 * but the browser needs seconds to leave; this holds the button busy until the
 * page unloads. Only `release()` (the failure path) clears it.
 *
 * Back-forward cache: a page restored by Back keeps its React state, so a held
 * value would show a stuck spinner. A `pageshow` with `persisted` bumps a
 * module-level restore count, and a hold only counts while it is from the
 * current count, so a restored page is never busy.
 *
 * In-app `router.push` navigations use `useTransition` instead (isPending lasts
 * until the new route renders).
 */
let restoreCount = 0;
const listeners = new Set<() => void>();

function handlePageShow(event: PageTransitionEvent) {
  if (!event.persisted) return;
  restoreCount += 1;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) window.addEventListener("pageshow", handlePageShow);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("pageshow", handlePageShow);
  };
}

const getSnapshot = () => restoreCount;
const getServerSnapshot = () => 0;

/** `held` is the value passed to `hold` (for example which button was clicked), or null when idle. */
export function useBusyUntilUnload<T = true>() {
  const restores = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [hold, setHold] = useState<{ value: T; restores: number } | null>(null);
  const held = hold !== null && hold.restores === restores ? hold.value : null;
  return {
    held,
    hold: (value: T) => setHold({ value, restores }),
    release: () => setHold(null),
  };
}
