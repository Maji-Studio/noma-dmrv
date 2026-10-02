import { describe, expect, it } from "vitest";
import { nextTransportDistanceSource } from "./distance-provenance";

describe("nextTransportDistanceSource", () => {
  it("claims map_estimate when the map estimate fills the distance", () => {
    expect(nextTransportDistanceSource("map_estimate", "manual")).toBe("map_estimate");
    expect(nextTransportDistanceSource("map_estimate", "document")).toBe("map_estimate");
  });

  it("flips a map estimate back to manual on a hand edit", () => {
    expect(nextTransportDistanceSource("manual", "map_estimate")).toBe("manual");
    expect(nextTransportDistanceSource(null, "map_estimate")).toBe("manual");
  });

  it("leaves an explicit manual or legacy document source alone on a hand edit", () => {
    expect(nextTransportDistanceSource("manual", "manual")).toBeUndefined();
    expect(nextTransportDistanceSource("manual", "document")).toBeUndefined();
    expect(nextTransportDistanceSource(null, "document")).toBeUndefined();
  });
});
