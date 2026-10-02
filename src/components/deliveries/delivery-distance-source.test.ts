import { describe, expect, it } from "vitest";
import { resolveDeliveryDistanceSourceChoice } from "./delivery-distance-source";

const inheritedManual = {
  storedDistanceKm: 240,
  storedDistanceSource: "manual" as const,
  hasOverride: false,
};

describe("resolveDeliveryDistanceSourceChoice", () => {
  it("turns the placeholder option into null, never an empty string", () => {
    expect(resolveDeliveryDistanceSourceChoice("", inheritedManual)).toEqual({ kind: "set", source: null });
    expect(
      resolveDeliveryDistanceSourceChoice("", { ...inheritedManual, hasOverride: true }),
    ).toEqual({ kind: "set", source: null });
  });

  it("ignores a value outside the source enum", () => {
    expect(resolveDeliveryDistanceSourceChoice("gps", inheritedManual)).toEqual({ kind: "set", source: null });
  });

  it("keeps a matching manual customer-location distance inherited", () => {
    expect(resolveDeliveryDistanceSourceChoice("manual", inheritedManual)).toEqual({ kind: "set", source: null });
  });

  it("stores manual on a delivery that overrides the distance", () => {
    expect(
      resolveDeliveryDistanceSourceChoice("manual", { ...inheritedManual, hasOverride: true }),
    ).toEqual({ kind: "set", source: "manual" });
  });

  it("returns to the stored route calculation when it is picked again", () => {
    expect(
      resolveDeliveryDistanceSourceChoice("map_estimate", {
        storedDistanceKm: 240,
        storedDistanceSource: "map_estimate",
        hasOverride: true,
      }),
    ).toEqual({ kind: "inherit-stored" });
  });

  it("stores a transport document as the delivery's own source", () => {
    expect(resolveDeliveryDistanceSourceChoice("document", inheritedManual)).toEqual({
      kind: "set",
      source: "document",
    });
  });
});
