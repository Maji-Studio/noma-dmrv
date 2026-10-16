import { expect, it } from "vitest";
import { facilityDistanceChanges } from "./facility-distance-changes";

it("omits unchanged and empty rows, including a distance reverted to its loaded value", () => {
  const saved = [{ facilityId: "saved", distanceKm: 12, distanceSource: "document" as const }];
  expect(facilityDistanceChanges([
    ...saved,
    { facilityId: "empty", distanceKm: null, distanceSource: "manual" },
  ], saved)).toEqual([]);
  expect(facilityDistanceChanges()).toEqual([]);
});

it("keeps sets, changes, provenance changes and explicit clears", () => {
  const saved = ["changed", "source", "cleared", "omitted"].map(facilityId => ({
    facilityId, distanceKm: 12, distanceSource: "manual" as const,
  }));
  const changed = [
    { facilityId: "new", distanceKm: 25, distanceSource: "manual" as const },
    { facilityId: "changed", distanceKm: 30, distanceSource: "manual" as const },
    { facilityId: "source", distanceKm: 12, distanceSource: "document" as const },
    { facilityId: "cleared", distanceKm: null, distanceSource: "manual" as const },
  ];
  expect(facilityDistanceChanges(changed, saved)).toEqual(changed);
});
