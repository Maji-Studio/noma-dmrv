"use client";

import { useState } from "react";

/** Width drawn before the first measurement. */
const INITIAL_WIDTH_PX = 960;

/** Track the element's content width. Keeps the last width while it is hidden. */
export function useMeasuredWidth(): [number, (element: HTMLDivElement | null) => (() => void) | undefined] {
  const [width, setWidth] = useState(INITIAL_WIDTH_PX);
  const measure = (element: HTMLDivElement | null) => {
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width);
      if (next > 0) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  };
  return [width, measure];
}
