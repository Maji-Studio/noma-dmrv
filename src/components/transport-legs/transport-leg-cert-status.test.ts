import { describe, expect, it } from "vitest";
import {
  deriveTransportLegCertStatuses,
  summarizeTransportLegCertStatuses,
} from "./transport-leg-cert-status";

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

describe("transport leg section CERT summary", () => {
  it("stays neutral while nothing is saved and names every requirement", () => {
    expect(
      summarizeTransportLegCertStatuses(
        deriveTransportLegCertStatuses(
          [{ distanceKm: 25, distanceSource: "manual", loadMassKg: 100 }],
          false,
          "feedstock",
        ),
      ),
    ).toEqual({
      status: "neutral",
      description:
        "Required for certification: distance, distance source and load.",
    });
  });

  it("names the requirements a saved leg is missing", () => {
    expect(
      summarizeTransportLegCertStatuses(
        deriveTransportLegCertStatuses(
          [{ distanceKm: 25, distanceSource: null, loadMassKg: null }],
          true,
          "feedstock",
        ),
      ),
    ).toEqual({
      status: "missing",
      description:
        "Required for certification. Not recorded: distance source and load.",
    });
  });

  it("reports a fully recorded leg as satisfied", () => {
    expect(
      summarizeTransportLegCertStatuses(
        deriveTransportLegCertStatuses(
          [{ distanceKm: 25, distanceSource: "manual", loadMassKg: 100 }],
          true,
          "feedstock",
        ),
      ),
    ).toEqual({
      status: "satisfied",
      description:
        "Required for certification. Every leg records distance, distance source and load.",
    });
  });

  it("omits provenance for entities that do not carry it", () => {
    expect(
      summarizeTransportLegCertStatuses(
        deriveTransportLegCertStatuses(
          [{ distanceKm: 25, distanceSource: null, loadMassKg: 100 }],
          true,
          "sample",
        ),
      ),
    ).toEqual({
      status: "satisfied",
      description: "Required for certification. Every leg records distance and load.",
    });
  });
});
