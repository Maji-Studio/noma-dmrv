"use client";

import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr";
import { DetailField, DetailRow } from "@/components/ui/detail-panel";
import type { GisBoundary } from "@/schemas/gis-boundary";
import { GeoJsonPreview } from "./geojson-preview";

const MAP_HEIGHT = "h-320";
const CENTER_DECIMALS = 5;
const AREA_DECIMALS = 2;

function countLabel(
  count: number,
  singular: string,
  plural: string,
): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function GisReferenceSummary({
  boundary,
  actions,
}: {
  boundary: GisBoundary;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-12">
      <div
        className={`w-full overflow-hidden border border-[var(--hair)] ${MAP_HEIGHT}`}
      >
        <GeoJsonPreview
          collection={boundary.collection}
          bbox={boundary.stats.bbox}
        />
      </div>

      <div className="flex flex-col gap-16">
        <DetailRow>
          <DetailField label="Source" value={sourceLabel(boundary)} />
          <DetailField label="Areas" value={areasValue(boundary)} />
        </DetailRow>
        <DetailRow>
          <DetailField label="Shapes" value={shapesValue(boundary)} />
          <DetailField label="Center" value={centerValue(boundary)} />
        </DetailRow>
      </div>

      {boundary.notes.map((note) => (
        <p
          key={note}
          className="flex items-start gap-6 body-caption text-[var(--st-wait)]"
        >
          <WarningCircleIcon size={14} weight="bold" className="mt-1 shrink-0" />
          {note}
        </p>
      ))}

      {actions}
    </div>
  );
}

function sourceLabel(boundary: GisBoundary): string {
  return boundary.source === "upload"
    ? (boundary.fileName ?? "Uploaded file")
    : "Pasted GeoJSON";
}

function areasValue(boundary: GisBoundary): string {
  const count = countLabel(boundary.stats.features, "area", "areas");
  return `${count}, ${boundary.stats.areaHectares.toFixed(AREA_DECIMALS)} ha`;
}

function shapesValue(boundary: GisBoundary): string {
  const polygons = boundary.collection.features.reduce(
    (total, feature) =>
      total +
      (feature.geometry.type === "Polygon"
        ? 1
        : feature.geometry.coordinates.length),
    0,
  );
  return `${countLabel(polygons, "polygon", "polygons")}, ${countLabel(
    boundary.stats.vertices,
    "vertex",
    "vertices",
  )}`;
}

function centerValue(boundary: GisBoundary): string {
  const [longitude, latitude] = boundary.stats.center;
  return `${latitude.toFixed(CENTER_DECIMALS)}, ${longitude.toFixed(
    CENTER_DECIMALS,
  )}`;
}
