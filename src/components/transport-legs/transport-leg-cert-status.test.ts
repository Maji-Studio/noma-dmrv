import { describe, expect, it } from "vitest";
import { deriveTransportLegCertStatuses } from "./transport-leg-cert-status";

describe("transport leg header CERT status", () => {
  it("keeps unsaved/deferred rows neutral", () => {
    expect(
      deriveTransportLegCertStatuses(
        [{ distanceKm: 25, distanceSource: "manual", loadMassKg: 100 }],
        false,
        "feedstock",
      ),
    ).toEqual({
      distance: "neutral",
      provenance: {
        label: "Transport distance provenance",
        status: "neutral",
      },
      load: "neutral",
    });
  });

  it("accepts manual distance provenance", () => {
    expect(
      deriveTransportLegCertStatuses(
        [{ distanceKm: 25, distanceSource: "manual", loadMassKg: 100 }],
        true,
        "feedstock",
      ),
    ).toEqual({
      distance: "satisfied",
      provenance: {
        label: "Transport distance provenance",
        status: "satisfied",
      },
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
        "feedstock",
      ),
    ).toEqual({
      distance: "satisfied",
      provenance: {
        label: "Transport distance provenance",
        status: "satisfied",
      },
      load: "satisfied",
    });
  });

  it.each(["sample", "biochar"] as const)(
    "does not show stale provenance certification for %s legs",
    (entityType) => {
      expect(
        deriveTransportLegCertStatuses(
          [{ distanceKm: 25, distanceSource: "manual", loadMassKg: 100 }],
          true,
          entityType,
        ),
      ).toEqual({
        distance: "satisfied",
        provenance: undefined,
        load: "satisfied",
      });
    },
  );
});
