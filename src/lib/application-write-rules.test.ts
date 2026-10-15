import { expect, it } from "vitest";
import { resolveApplicationDryMassTons, assertApplicationCapacity, assertApplicationDate } from "./application-write-rules";
it("allocates cumulative dry grams without losing the final gram", () => {
  expect(resolveApplicationDryMassTons({ requestedWetKg: 0.001, deliveryWetKg: 0.003, deliveryDryBiocharKg: 0.002, alreadyAppliedWetKg: 0, alreadyAppliedDryKg: 0 })).toBe(0.000001);
  expect(resolveApplicationDryMassTons({ requestedWetKg: 0.002, deliveryWetKg: 0.003, deliveryDryBiocharKg: 0.002, alreadyAppliedWetKg: 0.001, alreadyAppliedDryKg: 0.001 })).toBe(0.000001);
});
it("accepts exact remaining capacity and refuses one gram over with kg metadata", () => {
  expect(() => assertApplicationCapacity(4001, 4000, 1)).not.toThrow();
  try { assertApplicationCapacity(4001, 4000, 1.001); throw new Error("accepted"); } catch (error) {
    expect(error).toMatchObject({ code: "conflict", issues: [{ path: ["appliedWetMassKg"], meta: { measure: "delivery_remaining_wet", availableWetKg: 1, requestedWetKg: 1.001, unit: "kg" } }] });
  }
});
it.each([
  { zone: "America/Los_Angeles", clock: "2025-07-08T01:00Z", day: "2025-07-07", before: "2025-07-06", after: "2025-07-08" },
  { zone: "Asia/Tokyo", clock: "2025-07-08T20:00Z", day: "2025-07-09", before: "2025-07-08", after: "2025-07-10" },
])("compares calendar days in $zone, even when UTC disagrees", ({ zone, clock, day, before, after }) => {
  const instant = new Date(clock);
  expect(() => assertApplicationDate(new Date(day), instant, zone, "DL-X", instant)).not.toThrow();
  for (const refused of [before, after]) {
    expect(() => assertApplicationDate(new Date(refused), instant, zone, "DL-X", instant)).toThrow();
  }
});

it("refuses prior dry allocations that exceed the delivery", () => {
  expect(() => resolveApplicationDryMassTons({ requestedWetKg: 1000, deliveryWetKg: 5000, deliveryDryBiocharKg: 4000, alreadyAppliedWetKg: 4000, alreadyAppliedDryKg: 4500 })).toThrow("Tracked dry biochar is not available");
});
