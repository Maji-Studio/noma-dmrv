"use client";

import dynamic from "next/dynamic";
import type { GeoJsonPreviewMapProps } from "./geojson-preview-map";

export const GeoJsonPreview = dynamic<GeoJsonPreviewMapProps>(
  () => import("./geojson-preview-map"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center bg-[var(--color-background-light)]">
        <span className="body-caption text-[var(--color-text-tertiary)]">
          Loading map...
        </span>
      </div>
    ),
  },
);
