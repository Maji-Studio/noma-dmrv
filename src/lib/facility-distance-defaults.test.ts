import { expect, it } from "vitest";
import type { Facility } from "@/db/schema";
import { facilityDistanceDefaults } from "./facility-distance-defaults";

it("fills active facilities with null distances while preserving saved pairs and their order", () => {
  const facilities = [{ id: "first" }, { id: "second" }, { id: "archived", archivedAt: new Date() }] as Facility[];
  const saved = [{ facilityId: "second", distanceKm: 12, distanceSource: "document" as const },
    { facilityId: "other", distanceKm: 30, distanceSource: "manual" as const }];
  expect(facilityDistanceDefaults(facilities, saved)).toEqual([
    ...saved, { facilityId: "first", distanceKm: null, distanceSource: "manual" },
  ]);
  expect(saved).toHaveLength(2);
});

it("keeps an explicitly cleared distance and supports no facilities", () => {
  const saved = [{ facilityId: "first", distanceKm: null, distanceSource: "manual" as const }];
  expect(facilityDistanceDefaults([{ id: "first" }] as Facility[], saved)).toEqual(saved);
  expect(facilityDistanceDefaults([])).toEqual([]);
});
