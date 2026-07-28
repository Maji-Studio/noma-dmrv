import { describe, expect, it } from "vitest";
import {
  hasAcceptedTransportEvidence,
  isAcceptedTransportEvidenceDocument,
} from "./transport-evidence";

describe("transport evidence display predicates", () => {
  it.each([
    { count: 0, expected: false },
    { count: undefined, expected: false },
    { count: null, expected: false },
    { count: Number.NaN, expected: false },
    { count: 1, expected: true },
  ])("reports whether an accepted document count is present", ({ count, expected }) => {
    expect(hasAcceptedTransportEvidence(count)).toBe(expected);
  });

  it.each([
    {
      document: {
        uploadStatus: "uploaded",
        documentType: "bill_of_lading",
      },
      expected: true,
    },
    {
      document: {
        uploadStatus: "uploaded",
        documentType: "weighbridge_ticket",
      },
      expected: true,
    },
    {
      document: {
        uploadStatus: "uploaded",
        documentType: "other_transport_evidence",
      },
      expected: true,
    },
    {
      document: {
        uploadStatus: "pending",
        documentType: "bill_of_lading",
      },
      expected: false,
    },
    {
      document: {
        uploadStatus: "uploaded",
        documentType: "invoice",
      },
      expected: false,
    },
  ])(
    "accepts only uploaded, classified transport records",
    ({ document, expected }) => {
      expect(isAcceptedTransportEvidenceDocument(document)).toBe(expected);
    },
  );
});
