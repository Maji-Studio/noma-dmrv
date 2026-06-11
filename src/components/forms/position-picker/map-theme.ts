/**
 * Brand recoloring for MapLibre basemaps + DOM marker factory, per the
 * Carbon Viewer concept build (docs/plans/2026-06-10-map-integration.md →
 * "Design reference"): white land on orange-tinted paper, hairline plum
 * boundaries, all labels hidden — the map reads as a diagram, not a road map.
 *
 * MapLibre paints onto a canvas, so CSS variables can't be referenced in
 * paint properties directly; colors are resolved from the design tokens at
 * runtime via getComputedStyle (client-only module).
 */

import type { Map as MapLibreMap } from "maplibre-gl";

export type PickerAccent = "orange" | "purple" | "pink";

/** Marker accent per entity family (concept token mapping). */
const ACCENT_TOKEN: Record<PickerAccent, string> = {
  orange: "--clr-orange", // supplier / inbound
  purple: "--clr-purple", // facility / infrastructure
  pink: "--clr-pink", // field / outbound (pink on light bg, not rose)
};

/** Square site marker size (concept: 12px square, brutalist corners). */
const MARKER_SIZE_PX = 12;
const MARKER_BORDER = "1.5px solid var(--clr-dark-purple)";

/** Layers this component adds itself — never recolored or hidden. */
export const OWN_LAYER_PREFIX = "pp-";

interface MapThemeColors {
  /** Sea / background — orange-tinted paper. */
  bg: string;
  /** Landmass — white. */
  land: string;
  /** Country/admin boundaries — hairline plum. */
  boundary: string;
  /** Residual detail lines (roads, contours) — barely-there ink. */
  detail: string;
}

function resolveMapTheme(): MapThemeColors {
  const styles = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;
  return {
    bg: token("--clr-orange-10", "rgba(255, 131, 89, 0.1)"),
    land: token("--color-background-white", "#ffffff"),
    boundary: token("--clr-dark-purple-30", "rgba(15, 2, 26, 0.3)"),
    detail: token("--clr-dark-purple-10", "rgba(15, 2, 26, 0.1)"),
  };
}

const WATER_LAYER_PATTERN = /water|ocean|river|lake|waterway/i;
const BOUNDARY_LAYER_PATTERN = /boundary|admin/i;

/**
 * Recolor every base-style layer in place. Idempotent; call once after the
 * style loads. Layers added by the picker itself (OWN_LAYER_PREFIX) are
 * skipped. Individual failures are swallowed — a layer that rejects a paint
 * property should not take down the rest of the treatment.
 */
export function applyBrandRecolor(map: MapLibreMap): void {
  const layers = map.getStyle()?.layers;
  if (!layers) return;
  const theme = resolveMapTheme();

  for (const layer of layers) {
    const { id, type } = layer;
    if (id.startsWith(OWN_LAYER_PREFIX)) continue;
    try {
      switch (type) {
        case "symbol":
          // All place labels and icons hidden.
          map.setLayoutProperty(id, "visibility", "none");
          break;
        case "background":
          map.setPaintProperty(id, "background-color", theme.bg);
          break;
        case "fill": {
          const isWater = WATER_LAYER_PATTERN.test(id);
          map.setPaintProperty(id, "fill-color", isWater ? theme.bg : theme.land);
          map.setPaintProperty(id, "fill-outline-color", isWater ? theme.bg : theme.land);
          break;
        }
        case "line":
          if (WATER_LAYER_PATTERN.test(id)) {
            map.setLayoutProperty(id, "visibility", "none");
          } else if (BOUNDARY_LAYER_PATTERN.test(id)) {
            map.setPaintProperty(id, "line-color", theme.boundary);
            map.setPaintProperty(id, "line-width", 1);
          } else {
            map.setPaintProperty(id, "line-color", theme.detail);
          }
          break;
        default:
          // Hillshade, raster, fill-extrusion etc. from the base style —
          // not part of the diagram treatment.
          map.setLayoutProperty(id, "visibility", "none");
      }
    } catch {
      // Skip layers that reject a property; recoloring is best-effort.
    }
  }
}

/** Square accent marker element (DOM marker, draggable by MapLibre). */
export function createMarkerElement(accent: PickerAccent): HTMLDivElement {
  const el = document.createElement("div");
  el.dataset.testid = "position-picker-marker";
  el.style.width = `${MARKER_SIZE_PX}px`;
  el.style.height = `${MARKER_SIZE_PX}px`;
  el.style.background = `var(${ACCENT_TOKEN[accent]})`;
  el.style.border = MARKER_BORDER;
  el.style.boxSizing = "border-box";
  el.style.cursor = "grab";
  return el;
}
