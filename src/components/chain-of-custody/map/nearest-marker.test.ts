import { expect, it } from "vitest";
import { nearestPointWithin, TOUCH_PICK_RADIUS_PX } from "./nearest-marker";

const points = [
  { nodeId: "a", x: 100, y: 100 },
  { nodeId: "b", x: 120, y: 100 },
];

it("returns null when nothing is in range", () => {
  expect(nearestPointWithin(points, { x: 300, y: 300 })).toBeNull();
  expect(nearestPointWithin([], { x: 0, y: 0 })).toBeNull();
});

it("picks a single point within the 22px radius, and not one just outside", () => {
  expect(TOUCH_PICK_RADIUS_PX).toBe(22);
  expect(nearestPointWithin([points[0]!], { x: 100, y: 118 })).toBe("a");
  expect(nearestPointWithin([points[0]!], { x: 100, y: 123 })).toBeNull();
});

it("picks the nearest when two are in range", () => {
  expect(nearestPointWithin(points, { x: 108, y: 100 })).toBe("a");
  expect(nearestPointWithin(points, { x: 113, y: 100 })).toBe("b");
});

it("breaks a tie by list order", () => {
  expect(nearestPointWithin(points, { x: 110, y: 100 })).toBe("a");
  expect(nearestPointWithin([...points].reverse(), { x: 110, y: 100 })).toBe("b");
});
