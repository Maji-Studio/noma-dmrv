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
      evidence: "neutral",
      load: "neutral",
    });
  });

  it("accepts manual distance provenance while missing evidence stays separate", () => {
    expect(
      deriveTransportLegCertStatuses(
        [{ distanceKm: 25, distanceSource: "manual", loadMassKg: 100 }],
        true,
      ),
    ).toEqual({
      distance: "satisfied",
      provenance: "satisfied",
      evidence: "missing",
      load: "satisfied",
    });
  });

  it("marks all persisted requirements green with recorded provenance and an upload", () => {
    expect(
      deriveTransportLegCertStatuses(
        [
          {
            distanceKm: 25,
            distanceSource: "document",
            loadMassKg: 100,
            transportEvidenceDocumentCount: 1,
          },
        ],
        true,
      ),
    ).toEqual({
      distance: "satisfied",
      provenance: "satisfied",
      evidence: "satisfied",
      load: "satisfied",
    });
  });

  it("keeps evidence orange when no file is uploaded", () => {
    expect(
      deriveTransportLegCertStatuses(
        [
          {
            distanceKm: 25,
            distanceSource: "document",
            loadMassKg: 100,
            transportEvidenceDocumentCount: 0,
          },
        ],
        true,
      ),
    ).toEqual({
      distance: "satisfied",
      provenance: "satisfied",
      evidence: "missing",
      load: "satisfied",
    });
  });

  it("fails closed when a saved row omits its evidence count", () => {
    expect(
      deriveTransportLegCertStatuses(
        [{ distanceKm: 25, distanceSource: "document", loadMassKg: 100 }],
        true,
      ).evidence,
    ).toBe("missing");
  });
});
