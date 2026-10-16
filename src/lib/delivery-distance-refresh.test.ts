import { expect, it } from "vitest";
import type { Delivery } from "@/db/schema";
import { deliveryAfterDistanceFill } from "./delivery-distance-refresh";

const opened = { id: "delivery", version: 3, recordedDistanceKm: null,
  recordedDistanceSource: null, distanceNote: "", deliveredWetMassKg: 100 } as Delivery;
const filled = { ...opened, version: 4, recordedDistanceKm: 25, recordedDistanceSource: "manual" as const };

it("accepts only a missing-distance fill and its version increment", () => {
  expect(deliveryAfterDistanceFill(opened, filled)).toMatchObject({
    recordedDistanceKm: 25, recordedDistanceSource: "manual", version: 4,
  });
});
it("keeps the opening version for unrelated edits, skipped versions and recorded distances", () => {
  expect(deliveryAfterDistanceFill(opened, { ...filled, distanceNote: "changed" })).toBe(opened);
  expect(deliveryAfterDistanceFill(opened, { ...filled, version: 5 })).toBe(opened);
  expect(deliveryAfterDistanceFill(filled, { ...filled, version: 5, recordedDistanceKm: 80 })).toBe(filled);
});
