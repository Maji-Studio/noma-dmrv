// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isProofOfDeliveryDocument } from "@/lib/certification/delivery-evidence";
import { isLabReportDocument } from "@/lib/certification/lab-report";

const mocks = vi.hoisted(() => ({ data: undefined as unknown }));
vi.mock("@/hooks/use-documents", () => ({
  useDocumentsForEntity: () => ({ data: mocks.data }),
}));

import { useDocumentsCertStatus } from "./use-documents-cert-status";

function status(entityId: string | undefined, qualifies: Parameters<typeof useDocumentsCertStatus>[2]) {
  return renderHook(() => useDocumentsCertStatus("delivery", entityId, qualifies)).result.current;
}

const doc = (documentType: string, uploadStatus = "uploaded") => ({ documentType, uploadStatus });

afterEach(() => {
  cleanup();
  mocks.data = undefined;
});

describe("useDocumentsCertStatus", () => {
  it("stays neutral while creating, with no saved record", () => {
    mocks.data = [];
    expect(status(undefined, isProofOfDeliveryDocument)).toBe("neutral");
  });

  it("stays neutral while the documents load", () => {
    expect(status("d1", isProofOfDeliveryDocument)).toBe("neutral");
  });

  it("is missing when a saved delivery has no proof of delivery", () => {
    mocks.data = [doc("weighbridge_ticket")];
    expect(status("d1", isProofOfDeliveryDocument)).toBe("missing");
  });

  it("is missing while the proof file is still uploading", () => {
    mocks.data = [doc("delivery_receipt", "pending")];
    expect(status("d1", isProofOfDeliveryDocument)).toBe("missing");
  });

  it.each(["delivery_receipt", "bill_of_lading", "photo"])("is satisfied by an uploaded %s", (type) => {
    mocks.data = [doc(type)];
    expect(status("d1", isProofOfDeliveryDocument)).toBe("satisfied");
  });

  it("is missing for a Sample with only a reflectance histogram, satisfied with a lab report", () => {
    mocks.data = [doc("reflectance_histogram")];
    expect(status("s1", isLabReportDocument)).toBe("missing");
    cleanup();
    mocks.data = [doc("reflectance_histogram"), doc("lab_report")];
    expect(status("s1", isLabReportDocument)).toBe("satisfied");
  });

  it.each(["pending", "failed"])("does not count a %s lab report", (uploadStatus) => {
    mocks.data = [doc("lab_report", uploadStatus)];
    expect(status("s1", isLabReportDocument)).toBe("missing");
  });
});
