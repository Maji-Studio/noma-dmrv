/**
 * Carbon Viewer ("Geography — carbon in transit") constants, per the concept
 * build distilled in docs/plans/2026-06-10-map-integration.md → Design
 * reference. Marker geometry, layer ids, arc shaping, and animation timing
 * live here so the map component carries no magic numbers.
 */

// Direct module import (not the barrel) keeps this file free of React
// component imports — viewer-utils + unit tests stay pure.
import { OWN_LAYER_PREFIX, type MapAccent } from "@/components/map/map-theme";
import type { ChainGeoNodeKind } from "@/data-access/chain-of-custody-geo";

// ---------------------------------------------------------------------------
// Sources & layers (all prefixed so applyBrandRecolor never touches them)
// ---------------------------------------------------------------------------

export const LEGS_SOURCE_ID = `${OWN_LAYER_PREFIX}cv-legs`;
export const LEGS_BASE_LAYER_ID = `${OWN_LAYER_PREFIX}cv-legs-base`;
export const LEGS_DASH_LAYER_ID = `${OWN_LAYER_PREFIX}cv-legs-dash`;
/** Transparent wide line on top of the legs — the hover hit-target. */
export const LEGS_HIT_LAYER_ID = `${OWN_LAYER_PREFIX}cv-legs-hit`;
export const SAT_SOURCE_ID = `${OWN_LAYER_PREFIX}cv-sat`;
export const SAT_LAYER_ID = `${OWN_LAYER_PREFIX}cv-sat-layer`;

// ---------------------------------------------------------------------------
// Marker treatment (concept: brutalist squares, side labels with paper halo)
// ---------------------------------------------------------------------------

/** Marker family per plotted node kind. */
export type ViewerMarkerKind = "supplier" | "facility" | "field";

export const MARKER_ACCENT: Record<ViewerMarkerKind, MapAccent> = {
  supplier: "orange", // feedstock origin
  facility: "purple", // pyrolysis hub
  field: "pink", // application field
};

/**
 * Rail/chip accent per chain node kind. On the map, distribution uses PINK
 * (not the DAG's rose — rose fails contrast on white; see plan token mapping).
 */
export const NODE_ACCENT_VAR: Record<ChainGeoNodeKind, string> = {
  facility: "var(--clr-purple)",
  reactor: "var(--clr-purple)",
  feedstock: "var(--clr-orange)",
  productionRun: "var(--clr-orange)",
  biocharProduct: "var(--clr-orange)",
  order: "var(--clr-pink)",
  delivery: "var(--clr-pink)",
  application: "var(--clr-pink)",
};

/** Supplier square / field diamond size (px). */
export const SITE_MARKER_SIZE_PX = 12;
/** Facility square size (px) — larger, with a punched-out center. */
export const FACILITY_MARKER_SIZE_PX = 18;
/** Punched-out center inset on the facility marker (px). */
export const FACILITY_MARKER_INSET_PX = 5;
/** Hover/highlight outline ring size (px). */
export const MARKER_RING_SIZE_PX = 26;
export const FACILITY_RING_SIZE_PX = 32;

// ---------------------------------------------------------------------------
// Route lines ("carbon in transit")
// ---------------------------------------------------------------------------

/** Bezier samples for the bowed-arc fallback (reads as a curve). */
export const ARC_SEGMENTS = 28;
/** Max perpendicular bow, degrees (concept value). */
export const ARC_MAX_BOW = 0.045;
/** Bow as a fraction of the leg's length, capped by ARC_MAX_BOW. */
export const ARC_BOW_FACTOR = 0.22;

export const LEG_LINE_WIDTH = 1.6;
/**
 * Resting leg-line opacity — deliberately soft so overlapping arcs read as a
 * weave rather than a tangle. Hover isolation (below) lifts the active leg out
 * of the wash and pushes the rest back.
 */
export const LEG_LINE_OPACITY = 0.5;
/** Hovered leg (line + chip) on top of everything. */
export const LEG_HOVER_OPACITY = 0.95;
/** Every other leg while one is hovered — present but ghosted. */
export const LEG_HOVER_DIM_OPACITY = 0.08;
/** Invisible hover hit-target width (px) — far wider than the visible line. */
export const LEG_HIT_WIDTH = 14;
export const DASH_LINE_WIDTH = 1.5;

/**
 * Marching-ants dash sequence (concept build) — cycled on an interval, the
 * dash gap appears to travel along the line and conveys flow direction.
 */
export const ANTS_DASH_SEQUENCE: number[][] = [
  [0, 4, 3],
  [0.5, 4, 2.5],
  [1, 4, 2],
  [1.5, 4, 1.5],
  [2, 4, 1],
  [2.5, 4, 0.5],
  [3, 4, 0],
  [0, 0.5, 3, 3.5],
  [0, 1, 3, 3],
  [0, 1.5, 3, 2.5],
  [0, 2, 3, 2],
  [0, 2.5, 3, 1.5],
  [0, 3, 3, 1],
  [0, 3.5, 3, 0.5],
];
export const ANTS_INTERVAL_MS = 90;

/** Dasharray for the straight fallback when no road geometry resolved. */
export const FALLBACK_DASHARRAY = [2, 2];

// Distance chips sit at a staggered point along each line so neighbouring
// arcs don't collide: fraction = CHIP_BASE_FRACTION + (i % CHIP_STAGGER_STEPS)
// * CHIP_STAGGER_FRACTION along the polyline.
export const CHIP_BASE_FRACTION = 0.32;
export const CHIP_STAGGER_FRACTION = 0.18;
export const CHIP_STAGGER_STEPS = 3;

// ---------------------------------------------------------------------------
// View behaviour
// ---------------------------------------------------------------------------

export const FIT_PADDING = { top: 96, bottom: 70, left: 110, right: 130 } as const;
/** Extra right padding when the side rail is visible (map view). */
export const FIT_PADDING_RIGHT_WITH_RAIL = 330;
export const FIT_MAX_ZOOM = 10.4;
export const FIT_DURATION_MS = 700;
export const HIGHLIGHT_EASE_DURATION_MS = 650;
/** How long a cross-link highlight ring stays on a marker. */
export const HIGHLIGHT_HOLD_MS = 2600;

export const POPUP_WIDTH_PX = 246;
export const POPUP_OFFSET_PX = 20;

// ---------------------------------------------------------------------------
// Cross-surface focus dimming
// ---------------------------------------------------------------------------

/**
 * Opacity for out-of-focus elements when a focus is active — rail cards, map
 * markers, distance chips, and leg lines all dim to this so the focused
 * sub-chain reads as the figure. Mirrored as the `.cvm-dim` literal in
 * carbon-viewer.css for the imperatively-managed marker/chip DOM.
 */
export const FOCUS_DIM_OPACITY = 0.28;
