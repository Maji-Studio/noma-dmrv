import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GeoJsonPreview } from "@/components/applications/geojson-preview";
import { env } from "@/config/env";
import {
  MAP_SMOKE_BBOX,
  MAP_SMOKE_BOUNDARY,
  MAP_SMOKE_STYLE_URL,
} from "./map-smoke-fixture";

export const metadata: Metadata = {
  title: "Map smoke",
  robots: "noindex",
};

/**
 * Test-only page for tests/e2e/map-smoke.spec.ts: the real GIS boundary
 * preview map, pointed at a fixture basemap the spec serves through
 * `page.route`. It proves the bundled MapLibre worker starts and loads vector
 * tiles, which no keyless CI page otherwise exercises.
 *
 * Never served by a real deployment: production accepts GEO_PROVIDER=stub
 * only on a hermetic CI build (see the fail-closed gate in src/config/env.ts).
 */
export default function MapSmokePage() {
  if (env.NODE_ENV === "production" && env.GEO_PROVIDER !== "stub") {
    notFound();
  }

  return (
    <main className="h-screen w-full">
      <GeoJsonPreview
        collection={MAP_SMOKE_BOUNDARY}
        bbox={MAP_SMOKE_BBOX}
        basemapStyleUrl={MAP_SMOKE_STYLE_URL}
      />
    </main>
  );
}
