import { describe, expect, it } from "vitest";
import { deriveTransportLegCertStatuses } from "./transport-leg-cert-status";

describe("transport leg header CERT status", () => {
  it("keeps unsaved/deferred rows neutral", () => {
    expect(
      deriveTransportLegCertStatuses(
        [{ distanceKm: 25, distanceSource: "manual", loadMassKg: 100 }],
        false,
      ),
    ).toEqual({
      distance: "neutral",
      provenance: "neutral",
      load: "neutral",
    });
  });

  it("accepts manual distance provenance", () => {
    expect(
      deriveTransportLegCertStatuses(
        [{ distanceKm: 25, distanceSource: "manual", loadMassKg: 100 }],
        true,
      ),
    ).toEqual({
      distance: "satisfied",
      provenance: "satisfied",
      load: "satisfied",
    });
  });

  it("marks all persisted requirements green with recorded provenance", () => {
    expect(
      deriveTransportLegCertStatuses(
        [
          {
            distanceKm: 25,
            distanceSource: "document",
            loadMassKg: 100,
          },
        ],
        true,
      ),
    ).toEqual({
      distance: "satisfied",
      provenance: "satisfied",
      load: "satisfied",
    });
  });
});
