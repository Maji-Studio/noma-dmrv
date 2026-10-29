"use client";

/** The Traceability Map's canvas, fetched only when the map renders (maplibre-gl is large). */
import dynamic from "next/dynamic";

export const LazyTraceMapCanvas = dynamic(() => import("./trace-map-canvas"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-[var(--color-background-light)]">
      <span className="body-small font-medium text-[var(--color-text-tertiary)]">Loading map…</span>
    </div>
  ),
});
