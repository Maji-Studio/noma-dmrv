/**
 * Phone taps on the trace map resolve to the nearest marker, so a 12px shape
 * still has a 44px touch target without transparent pads that overlap and
 * steal taps from each other.
 */
import { TOUCH_TARGET_PX } from "@/components/ui/touch-target";

/** A tap within this distance on each axis of a marker's centre (a 44px square) counts as a tap on it. */
export const TOUCH_PICK_HALF_PX = TOUCH_TARGET_PX / 2;

export interface PickPoint {
  nodeId: string;
  x: number;
  y: number;
}

/**
 * The id of the point nearest the tap among those inside the square of
 * half-size `half` around it (edges inclusive), else null. A tie goes to the
 * earlier point in `points`, so the result is deterministic.
 */
export function nearestPointWithin(
  points: readonly PickPoint[],
  tap: { x: number; y: number },
  half: number = TOUCH_PICK_HALF_PX,
): string | null {
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const point of points) {
    const dx = Math.abs(point.x - tap.x);
    const dy = Math.abs(point.y - tap.y);
    if (dx > half || dy > half) continue;
    const distance = Math.hypot(dx, dy);
    if (distance < bestDistance) {
      best = point.nodeId;
      bestDistance = distance;
    }
  }
  return best;
}

export type MapTapResult = { kind: "marker"; nodeId: string } | { kind: "background" };

/**
 * What a tap on the map canvas does. On phones a tap near a marker is a tap on
 * the nearest one; with no marker in range, and always on desktop, it is a tap
 * on the background.
 */
export function resolveMapTap({
  nearestMarkerTaps,
  markers,
  tap,
}: {
  nearestMarkerTaps: boolean;
  markers: readonly PickPoint[];
  tap: { x: number; y: number };
}): MapTapResult {
  const nodeId = nearestMarkerTaps ? nearestPointWithin(markers, tap) : null;
  return nodeId ? { kind: "marker", nodeId } : { kind: "background" };
}
