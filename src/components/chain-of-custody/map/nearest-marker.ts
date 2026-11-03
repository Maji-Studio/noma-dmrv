/**
 * Phone taps on the trace map resolve to the nearest marker, so a 12px shape
 * still has a 44px touch target without transparent pads that overlap and
 * steal taps from each other.
 */

/** The minimum touch target (docs/design-system.md: 44px is on the spacing scale). */
export const TOUCH_TARGET_PX = 44;
/** A tap within this distance of a marker's centre counts as a tap on it. */
export const TOUCH_PICK_RADIUS_PX = TOUCH_TARGET_PX / 2;

export interface PickPoint {
  nodeId: string;
  x: number;
  y: number;
}

/**
 * The id of the point nearest the tap within `radius` (inclusive), else null.
 * A tie goes to the earlier point in `points`, so the result is deterministic.
 */
export function nearestPointWithin(
  points: readonly PickPoint[],
  tap: { x: number; y: number },
  radius: number = TOUCH_PICK_RADIUS_PX,
): string | null {
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const point of points) {
    const distance = Math.hypot(point.x - tap.x, point.y - tap.y);
    if (distance <= radius && distance < bestDistance) {
      best = point.nodeId;
      bestDistance = distance;
    }
  }
  return best;
}
