import { describe, expect, it } from "vitest";
import { deriveDeliveryEvidenceCertStatus } from "./delivery-evidence-cert-status";

const receipt = {
  uploadStatus: "uploaded",
  documentType: "delivery_receipt",
  metadata: {},
};
const rolePhoto = {
  uploadStatus: "uploaded",
  documentType: "photo",
  metadata: { deliveryEvidenceRole: "proof_of_delivery" },
};
const ticket = {
  uploadStatus: "uploaded",
  documentType: "weighbridge_ticket",
  metadata: {},
};

describe("deriveDeliveryEvidenceCertStatus", () => {
  it("stays neutral while creating", () => {
    expect(deriveDeliveryEvidenceCertStatus(undefined, false)).toBe("neutral");
    expect(deriveDeliveryEvidenceCertStatus([receipt], false)).toBe("neutral");
  });

  it("stays neutral while the saved document list loads", () => {
    expect(deriveDeliveryEvidenceCertStatus(undefined, true)).toBe("neutral");
  });

  it("is satisfied by one uploaded proof-of-delivery document", () => {
    expect(deriveDeliveryEvidenceCertStatus([receipt], true)).toBe("satisfied");
    expect(deriveDeliveryEvidenceCertStatus([ticket, rolePhoto], true)).toBe(
      "satisfied",
    );
  });

  it("is missing when only retention records exist", () => {
    expect(deriveDeliveryEvidenceCertStatus([], true)).toBe("missing");
    expect(deriveDeliveryEvidenceCertStatus([ticket], true)).toBe("missing");
    expect(
      deriveDeliveryEvidenceCertStatus(
        [{ ...receipt, uploadStatus: "pending" }],
        true,
      ),
    ).toBe("missing");
  });
});
