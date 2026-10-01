/**
 * Shared frame for the monoline illustration set. One drawing, two sizes: the
 * card size sits beside two lines of choice-card text, the empty-state size
 * stands above an empty-state heading. The stroke stays a constant on-screen
 * weight per size (1.5px at card size, 2px at empty-state size), so the scaled
 * drawing does not turn heavy. Decorative: always aria-hidden.
 */

import type { ReactNode } from "react";

/** Every drawing is laid out on this grid, in view-box units. */
export const VIEW_WIDTH = 56;
export const VIEW_HEIGHT = 40;
/** Rendered widths in px. */
export const ILLUSTRATION_SIZE = { card: 56, empty: 96 } as const;
/** On-screen stroke weight in px per size. */
const STROKE_CARD = 1.5;
const STROKE_EMPTY = 2;
/** Widths at or above this use the heavier empty-state stroke. */
const EMPTY_STROKE_FROM = 80;
const GROUND_STROKE = 1;
const GROUND_OPACITY = 0.5;
const GROUND_Y = 37;
const GROUND_INSET = 2;
const GROUND_DASH = "1 4";
/** Radius of the tiny solid grains and vertices, in view-box units. */
export const DOT_RADIUS = 1.4;
/** Radius of the slightly larger vertices on plotted shapes (field corners, chart points). */
export const VERTEX_RADIUS = 1.6;

export interface IllustrationProps {
  className?: string;
  /** Rendered width in px. Height follows the aspect ratio. Defaults to the card size. */
  size?: number;
}

interface FrameProps extends IllustrationProps {
  /** Half-opacity ground line: solid, dotted (a road or route), or none. */
  ground?: "solid" | "dotted" | "none";
  children: ReactNode;
}

export function IllustrationFrame({
  size = ILLUSTRATION_SIZE.card,
  className,
  ground = "none",
  children,
}: FrameProps) {
  const strokePx = size >= EMPTY_STROKE_FROM ? STROKE_EMPTY : STROKE_CARD;
  const unitsPerPx = VIEW_WIDTH / size;
  return (
    <svg
      className={className}
      width={size}
      height={(size * VIEW_HEIGHT) / VIEW_WIDTH}
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokePx * unitsPerPx}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable={false}
    >
      {ground !== "none" && (
        <path
          d={`M${GROUND_INSET} ${GROUND_Y} H${VIEW_WIDTH - GROUND_INSET}`}
          strokeWidth={GROUND_STROKE * unitsPerPx}
          strokeDasharray={ground === "dotted" ? GROUND_DASH : undefined}
          opacity={GROUND_OPACITY}
        />
      )}
      {children}
    </svg>
  );
}

/** Tiny solid dots (grains, vertices, hubs). Points are [x, y] in view-box units. */
export function Dots({ points, radius = DOT_RADIUS }: { points: readonly (readonly [number, number])[]; radius?: number }) {
  return points.map(([cx, cy]) => (
    <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={radius} fill="currentColor" stroke="none" />
  ));
}
