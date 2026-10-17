import { expect, it } from "vitest";
import { partyLocationFixturePlan } from "./fixture-party-locations";

it("seeds a complete pickup for the omission regression", () => {
  expect(partyLocationFixturePlan("supplier-location-update")).toMatchObject({
    kind: "supplier", locations: [{ name: "Existing pickup", city: "Dar es Salaam", country: "Tanzania", isDefault: true }],
    order: false, archive: false,
  });
});
it.each(["customer-field-missing-gps", "customer-location-archive", "customer-location-in-use", "order-archived-destination"] as const)("seeds the customer target for %s", id => {
  const plan = partyLocationFixturePlan(id)!;
  expect(plan.kind).toBe("customer");
  expect(plan.locations).toHaveLength(2);
  expect(plan.locations[0].isDefault).toBe(true);
  expect(plan.locations[1]).toMatchObject({ name: "North Block", isDefault: false, defaultSoilTemperatureC: 23.5 });
  expect(plan.order).toBe(["customer-location-in-use", "order-archived-destination"].includes(id));
  expect(plan.archive).toBe(id === "order-archived-destination");
});
