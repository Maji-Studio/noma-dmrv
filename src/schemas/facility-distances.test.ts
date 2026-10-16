import { expect, it } from "vitest";
import { facilityDistancesInputSchema } from "./facility-distances";

it("requires distanceKm on supplied pairs and accepts only explicit null for deletion", () => {
  const row = { facilityId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", distanceSource: "manual" };
  expect(facilityDistancesInputSchema.safeParse([row]).success).toBe(false);
  expect(facilityDistancesInputSchema.parse([{ ...row, distanceKm: null }])![0].distanceKm).toBeNull();
  expect(facilityDistancesInputSchema.parse(undefined)).toBeUndefined();
});
