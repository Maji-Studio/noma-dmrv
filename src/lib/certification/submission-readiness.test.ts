import { describe, expect, it } from "vitest";
import { deliveryProofBlocker, hasDurabilityMeasurementComponents, applicationDestinationBlocker, deliveryDistanceBlocker, durabilityConfigurationBlockers, missingFeedstockTransportIds } from "./submission-readiness";

const sampled = { sampling: "sampled", durabilityOption: "1000_year" };

describe("submission readiness predicates", () => {
  it.each([
    ["carbon_rich_substance_sequestration", false],
    ["biochar_sequestration_200_year_c_org", true],
    ["biochar_sequestration_1000_year_f_durable_max", true],
  ])("scopes measurement-sample refusals for %s", (blueprint_key, expected) => {
    const template = { groups: [{ components: [{ blueprint_key }] }] } as Parameters<typeof hasDurabilityMeasurementComponents>[0];
    expect(hasDurabilityMeasurementComponents(template)).toBe(expected);
  });

  it("requires a usable leg for each feedstock, not just one in the category", () => {
    expect(missingFeedstockTransportIds(["FS-1", "FS-2", "FS-3"], [
      { entityId: "FS-1", distanceKm: 10, loadMassKg: 100 },
      { entityId: "FS-2", distanceKm: 0, loadMassKg: 100 },
    ])).toEqual(["FS-2", "FS-3"]);
  });
  it.each([null, 0, -1, NaN, Infinity])("rejects unusable distance or mass %s", (value) => {
    expect(missingFeedstockTransportIds(["FS-1"], [{ entityId: "FS-1", distanceKm: value, loadMassKg: 100 }])).toEqual(["FS-1"]);
    expect(missingFeedstockTransportIds(["FS-1"], [{ entityId: "FS-1", distanceKm: 10, loadMassKg: value }])).toEqual(["FS-1"]);
  });
  it("names the Application and directs the operator to the order", () => {
    expect(applicationDestinationBlocker({ applicationCode: "AP-1", customerLocationId: null })).toContain("Application AP-1 has no customer location. Select a customer location on the order");
    expect(applicationDestinationBlocker({ applicationCode: "AP-1", customerLocationId: "location" })).toBeNull();
  });
  it("accepts either positive distance source and checks delivered deliveries only", () => {
    const input = { deliveryCode: "DL-1", deliveryStatus: "delivered", distanceKmOverride: null, recordedDistanceKm: null };
    expect(deliveryDistanceBlocker(input)).toContain("Delivery DL-1 has no positive transport distance");
    expect(deliveryDistanceBlocker({ ...input, distanceKmOverride: 5 })).toBeNull();
    expect(deliveryDistanceBlocker({ ...input, recordedDistanceKm: 5 })).toBeNull();
    expect(deliveryDistanceBlocker({ ...input, distanceKmOverride: 0, recordedDistanceKm: 5 })).toBeNull();
    expect(deliveryDistanceBlocker({ ...input, deliveryStatus: "scheduled" })).toBeNull();
  });
  it.each([
    [[{ ...sampled, sampling: "unsampled" }], "Unsampled Method B"],
    [[{ ...sampled, durabilityOption: "200_year" }], "200-year Removals"],
    [[sampled, sampled], "one credit batch"],
  ] as const)("shares durability refusals with submission", (batches, message) => {
    expect(durabilityConfigurationBlockers(batches).join(" ")).toContain(message);
  });
  it("accepts one sampled 1000-year batch", () => {
    expect(durabilityConfigurationBlockers([sampled])).toEqual([]);
  });
});

describe("delivery proof readiness", () => {
  it("requires at least one uploaded proof document", () => {
    expect(deliveryProofBlocker({ deliveryCode: "D-0012", proofOfDeliveryCount: 0 })).toBe(
      "Delivery D-0012 has no proof of delivery. Attach a delivery receipt, bill of lading or delivery photo before submitting.",
    );
    expect(deliveryProofBlocker({ deliveryCode: "D-0012", proofOfDeliveryCount: 1 })).toBeNull();
  });
});
