/**
 * Shared frame for the monoline illustration set. One drawing, two sizes: the
 * card size sits beside two lines of choice-card text, the empty-state size
 * stands above an empty-state heading. The stroke stays a constant on-screen
 * weight per size (1.5px at card size, 2px at empty-state size), so the scaled
 * drawing does not turn heavy. Decorative: always aria-hidden.
 *
 * Motion: parts wrapped in `Motion` play a short loop while the host is hovered
 * or keyboard focused (a choice card's label, or any `.illo-host` such as an
 * empty state). The keyframes live in globals.css under "Illustrations"; the
 * class names here must match it. Card-size drawings play only their key part,
 * large drawings play every part. Without motion the drawing shows its settled
 * state: every keyframe starts and ends there.
 */

import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

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
  const large = size >= EMPTY_STROKE_FROM;
  const strokePx = large ? STROKE_EMPTY : STROKE_CARD;
  const unitsPerPx = VIEW_WIDTH / size;
  return (
    <svg
      className={cn("illo", large && "illo-lg", className)}
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
          className={ground === "dotted" ? "illo-m illo-road" : undefined}
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

/**
 * The loops a part can play (keyframes `illo-<kind>` in globals.css):
 * bob (rises and settles), rise (smoke drifting up), flicker (a flame),
 * sway (rocks on its base), pop (shrinks away and springs back), drop (falls
 * into place), lift (lifts and sets down), draw (the stroke redraws; give each
 * path `pathLength={1}`), stamp (presses down like a seal).
 */
export type MotionKind = "bob" | "rise" | "flicker" | "sway" | "pop" | "drop" | "lift" | "draw" | "stamp";

interface MotionProps {
  kind: MotionKind;
  /** Offset into the loop, in ms, to stagger sibling parts. */
  delay?: number;
  /** Play only on large drawings (empty states, onboarding); card-size drawings keep this part still. */
  largeOnly?: boolean;
  children: ReactNode;
}

export function Motion({ kind, delay, largeOnly = false, children }: MotionProps) {
  const style = delay ? ({ "--illo-delay": `${delay}ms` } as CSSProperties) : undefined;
  return (
    <g className={cn("illo-m", `illo-${kind}`, largeOnly && "illo-lg-only")} style={style}>
      {children}
    </g>
  );
}
