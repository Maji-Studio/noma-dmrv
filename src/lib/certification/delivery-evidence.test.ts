import { describe, expect, it } from "vitest";
import {
  isAcceptedDeliveryEvidenceDocument,
  isDeliveryEvidenceDocumentType,
} from "./delivery-evidence";

describe("delivery evidence classifications", () => {
  it("keeps the five delivery upload classifications", () => {
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
  });
});
