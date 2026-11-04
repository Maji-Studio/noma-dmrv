/**
 * Carbon Viewer ("Geography: carbon in transit") constants, per the concept
 * build distilled in docs/archive/plans/2026-06-10-map-integration.md → Design
 * reference. Layer ids, arc shaping, and animation timing live here so the
 * map component carries no magic numbers.
 */

// Direct module import (not the barrel) keeps this file free of React
// component imports — viewer-utils + unit tests stay pure.
import { OWN_LAYER_PREFIX } from "@/components/map/map-theme";

// ---------------------------------------------------------------------------
// Sources & layers (all prefixed so applyBrandRecolor never touches them)
// ---------------------------------------------------------------------------

export const SAT_SOURCE_ID = `${OWN_LAYER_PREFIX}cv-sat`;
export const SAT_LAYER_ID = `${OWN_LAYER_PREFIX}cv-sat-layer`;

// ---------------------------------------------------------------------------
// Marker treatment (concept: brutalist squares, side labels with paper halo)
// ---------------------------------------------------------------------------

/** Marker family per plotted node kind. */
export type ViewerMarkerKind = "supplier" | "facility" | "field" | "customer";

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

// km labels sit at a staggered point along each line so neighbouring
// arcs don't collide: fraction = CHIP_BASE_FRACTION + (i % CHIP_STAGGER_STEPS)
// * CHIP_STAGGER_FRACTION along the polyline.
export const CHIP_BASE_FRACTION = 0.32;
export const CHIP_STAGGER_FRACTION = 0.18;
export const CHIP_STAGGER_STEPS = 3;

// ---------------------------------------------------------------------------
// View behaviour
// ---------------------------------------------------------------------------

export const FIT_DURATION_MS = 700;

const POPUP_WIDTH_PX = 246;
/** MapLibre's popup max-width: the card plus room for its 1.5px/3px borders. */
export const POPUP_MAX_WIDTH_PX = POPUP_WIDTH_PX + 8;
export const POPUP_OFFSET_PX = 20;
