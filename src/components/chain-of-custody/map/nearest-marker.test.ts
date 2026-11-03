import { expect, it } from "vitest";
import { nearestPointWithin, resolveMapTap, TOUCH_PICK_HALF_PX } from "./nearest-marker";

const points = [
  { nodeId: "a", x: 100, y: 100 },
  { nodeId: "b", x: 120, y: 100 },
];

it("returns null when nothing is in range", () => {
  expect(nearestPointWithin(points, { x: 300, y: 300 })).toBeNull();
  expect(nearestPointWithin([], { x: 0, y: 0 })).toBeNull();
});

it("picks a single point within 22px, and not one just outside", () => {
  expect(TOUCH_PICK_HALF_PX).toBe(22);
  expect(nearestPointWithin([points[0]!], { x: 100, y: 118 })).toBe("a");
  expect(nearestPointWithin([points[0]!], { x: 100, y: 123 })).toBeNull();
});

it("picks in a 44px square, so a corner offset is in and a 23px axis offset is out", () => {
  expect(nearestPointWithin([points[0]!], { x: 120, y: 120 })).toBe("a");
  expect(nearestPointWithin([points[0]!], { x: 123, y: 100 })).toBeNull();
});

it("picks the nearest when two are in range", () => {
  expect(nearestPointWithin(points, { x: 108, y: 100 })).toBe("a");
  expect(nearestPointWithin(points, { x: 113, y: 100 })).toBe("b");
});

it("breaks a tie by list order", () => {
  expect(nearestPointWithin(points, { x: 110, y: 100 })).toBe("a");
  expect(nearestPointWithin([...points].reverse(), { x: 110, y: 100 })).toBe("b");
});

it("resolves a phone tap in range to the marker", () => {
  expect(resolveMapTap({ nearestMarkerTaps: true, markers: points, tap: { x: 108, y: 100 } })).toEqual({ kind: "marker", nodeId: "a" });
});

it("resolves a phone tap out of range to the background", () => {
  expect(resolveMapTap({ nearestMarkerTaps: true, markers: points, tap: { x: 300, y: 300 } })).toEqual({ kind: "background" });
});

it("resolves a desktop tap to the background even when a marker is in range", () => {
  expect(resolveMapTap({ nearestMarkerTaps: false, markers: points, tap: { x: 108, y: 100 } })).toEqual({ kind: "background" });
});
