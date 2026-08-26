import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  documents: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/hooks/use-documents", () => ({
  documentKeys: { forEntity: () => ["documents"] },
  useDeleteDocument: () => ({ isPending: false }),
  useDocumentsForEntity: () => ({
    data: mocks.documents,
    error: null,
    isLoading: false,
  }),
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: vi.fn() }),
}));

import { TransportEvidencePanel } from "./transport-evidence-documents";

function uploadedDocument(patch: Record<string, unknown>) {
  return {
    id: "document-1",
    fileName: "file.pdf",
    fileSizeBytes: 1000,
    uploadStatus: "uploaded",
    metadata: {},
    ...patch,
  };
}

describe("TransportEvidencePanel chrome", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.documents = [];
  });

  it("keeps its heading and divider when used standalone", () => {
    const html = renderToStaticMarkup(
      <TransportEvidencePanel
        entityType="feedstock"
        entityId="feedstock-1"
        readOnly
      />,
    );

    expect(html).toContain("<h3");
    expect(html).toContain("Transport evidence</h3>");
    expect(html).toContain("border-t");
  });

  it("uses the parent heading without duplicate visible chrome when embedded", () => {
    const html = renderToStaticMarkup(
      <TransportEvidencePanel
        entityType="feedstock"
        entityId="feedstock-1"
        readOnly
        embedded
      />,
    );

    expect(html).not.toContain("Transport evidence</h3>");
    expect(html).not.toContain("border-t");
    expect(html).toContain('aria-label="Transport evidence"');
    expect(html).not.toContain("CERT");
  });

  it("titles the delivery panel as delivery evidence", () => {
    const html = renderToStaticMarkup(
      <TransportEvidencePanel
        entityType="delivery"
        entityId="delivery-1"
        readOnly
      />,
    );

    expect(html).toContain("Delivery evidence</h3>");
    expect(html).toContain("No delivery evidence");
    expect(html).toContain("No documents are attached.");
    expect(html).not.toContain("CERT");
  });
});

describe("delivery document list", () => {
  beforeEach(() => {
    mocks.documents = [];
  });

  it("lists Delivery documents as ordinary retained evidence", () => {
    mocks.documents = [
      uploadedDocument({
        id: "document-receipt",
        fileName: "receipt.pdf",
        documentType: "delivery_receipt",
      }),
      uploadedDocument({
        id: "document-photo",
        fileName: "drop.jpg",
        documentType: "photo",
      }),
      uploadedDocument({
        id: "document-ticket",
        fileName: "ticket.pdf",
        documentType: "weighbridge_ticket",
      }),
    ];

    const html = renderToStaticMarkup(
      <TransportEvidencePanel
        entityType="delivery"
        entityId="delivery-1"
        readOnly
      />,
    );

    expect(html).toContain("Delivery receipt");
    expect(html).toContain("Delivery photo");
    expect(html).toContain("Weigh-scale ticket");
    expect(html).not.toContain("Registry evidence");
    expect(html).not.toContain("Retention record");
  });

  it("labels every delivery photo consistently", () => {
    mocks.documents = [
      uploadedDocument({
        id: "document-photo",
        fileName: "drop.jpg",
        documentType: "photo",
      }),
    ];

    const html = renderToStaticMarkup(
      <TransportEvidencePanel
        entityType="delivery"
        entityId="delivery-1"
        readOnly
      />,
    );

    expect(html).toContain("Delivery photo");
    expect(html).not.toContain("Registry evidence");
  });

  it("never badges non-delivery owners", () => {
    mocks.documents = [
      uploadedDocument({
        id: "document-bol",
        fileName: "bol.pdf",
        documentType: "bill_of_lading",
      }),
    ];

    const html = renderToStaticMarkup(
      <TransportEvidencePanel
        entityType="feedstock"
        entityId="feedstock-1"
        readOnly
      />,
    );

    expect(html).toContain("Bill of lading");
    expect(html).not.toContain("Registry evidence");
    expect(html).not.toContain("Retention record");
  });
});
