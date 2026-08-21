import { describe, expect, it } from "vitest";
import {
  hasProofOfDeliveryRole,
  isAcceptedDeliveryEvidenceDocument,
  isDeliveryEvidenceDocumentType,
  isProofOfDeliveryDocument,
} from "./delivery-evidence";

describe("hasProofOfDeliveryRole", () => {
  it("recognises the stamped role", () => {
    expect(
      hasProofOfDeliveryRole({ deliveryEvidenceRole: "proof_of_delivery" }),
    ).toBe(true);
  });

  it.each([
    null,
    undefined,
    "proof_of_delivery",
    [],
    {},
    { deliveryEvidenceRole: "stockpile" },
    { evidenceRole: "proof_of_delivery" },
  ])("rejects %j", (metadata) => {
    expect(hasProofOfDeliveryRole(metadata)).toBe(false);
  });
});

describe("isProofOfDeliveryDocument", () => {
  it.each(["delivery_receipt", "bill_of_lading"])(
    "counts a %s by type alone",
    (documentType) => {
      expect(isProofOfDeliveryDocument({ documentType, metadata: {} })).toBe(
        true,
      );
    },
  );

  it("counts a photo only with the stamped role", () => {
    expect(
      isProofOfDeliveryDocument({
        documentType: "photo",
        metadata: { deliveryEvidenceRole: "proof_of_delivery" },
      }),
    ).toBe(true);
    expect(
      isProofOfDeliveryDocument({ documentType: "photo", metadata: {} }),
    ).toBe(false);
  });

  it.each(["weighbridge_ticket", "other_transport_evidence", "pdf"])(
    "keeps %s retention-only",
    (documentType) => {
      expect(isProofOfDeliveryDocument({ documentType, metadata: {} })).toBe(
        false,
      );
    },
  );
});

describe("isAcceptedDeliveryEvidenceDocument", () => {
  it("requires a finished upload of a listed type", () => {
    expect(
      isAcceptedDeliveryEvidenceDocument({
        uploadStatus: "uploaded",
        documentType: "delivery_receipt",
      }),
    ).toBe(true);
    expect(
      isAcceptedDeliveryEvidenceDocument({
        uploadStatus: "pending",
        documentType: "delivery_receipt",
      }),
    ).toBe(false);
    expect(
      isAcceptedDeliveryEvidenceDocument({
        uploadStatus: "uploaded",
        documentType: "lab_report",
      }),
    ).toBe(false);
  });
});

describe("isDeliveryEvidenceDocumentType", () => {
  it("covers the five uploader classifications and nothing else", () => {
    for (const documentType of [
      "bill_of_lading",
      "weighbridge_ticket",
      "other_transport_evidence",
      "delivery_receipt",
      "photo",
    ]) {
      expect(isDeliveryEvidenceDocumentType(documentType)).toBe(true);
    }
    expect(isDeliveryEvidenceDocumentType("video")).toBe(false);
  });
});
