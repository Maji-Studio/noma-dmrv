import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentRow } from "@/data-access/documents";

const documentsForEntity = vi.fn();

vi.mock("@/hooks/use-documents", () => ({
  documentKeys: {
    forEntity: (entityType: string, entityId: string) => [
      "documents",
      entityType,
      entityId,
    ],
  },
  useDeleteDocument: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useDocumentsForEntity: (...args: unknown[]) => documentsForEntity(...args),
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: vi.fn() }),
}));

vi.mock("@/components/forms", () => ({
  ServerError: ({ message }: { message: string }) => <p>{message}</p>,
}));

vi.mock("@/components/forms/form-file-upload", () => ({
  FormFileUpload: (props: {
    accept?: string;
    documentType?: string;
    onUploaded?: (documentId: string) => void;
  }) => (
    <div
      data-accept={props.accept}
      data-document-type={props.documentType}
      data-has-upload-callback={
        typeof props.onUploaded === "function" ? "true" : "false"
      }
    />
  ),
}));

vi.mock("@/components/forms/failed-deferred-attachments", () => ({
  FailedDeferredAttachments: () => null,
}));

vi.mock("@/components/ui/delete-confirm-dialog", () => ({
  DeleteConfirmDialog: () => null,
}));

import { ProductionReadingsDocuments } from "./production-readings-documents";

const DOCUMENT_ID = "11111111-1111-4111-8111-111111111111";

function readingsDocument(): DocumentRow {
  return {
    id: DOCUMENT_ID,
    fileName: "reactor-original.csv",
    fileSizeBytes: 2048,
    fileUrl: `/files/${DOCUMENT_ID}`,
    documentType: "sensor_data",
    uploadStatus: "uploaded",
    metadata: {
      readingsImport: {
        status: "failed",
        error: "Legacy import failure",
      },
    },
  } as unknown as DocumentRow;
}

describe("ProductionReadingsDocuments", () => {
  beforeEach(() => {
    documentsForEntity.mockReturnValue({
      data: [readingsDocument()],
      isLoading: false,
      error: null,
    });
  });

  it("shows stored metadata and authorized open/delete controls without import actions", () => {
    const html = renderToStaticMarkup(
      <ProductionReadingsDocuments productionRunId="run-1" />,
    );

    expect(html).toContain("reactor-original.csv");
    expect(html).toContain("2.0 KB");
    expect(html).toContain(`href="/api/documents/${DOCUMENT_ID}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('aria-label="Delete reactor-original.csv"');
    expect(html).not.toContain("Re-import");
    expect(html).not.toContain("Legacy import failure");
  });

  it("uploads a CSV as sensor_data with a completion callback", () => {
    const html = renderToStaticMarkup(
      <ProductionReadingsDocuments productionRunId="run-1" />,
    );

    expect(html).toContain('data-accept=".csv"');
    expect(html).toContain('data-document-type="sensor_data"');
    expect(html).toContain('data-has-upload-callback="true"');
  });

  it("does not present pending or failed upload rows as supplied files", () => {
    documentsForEntity.mockReturnValue({
      data: [
        { ...readingsDocument(), uploadStatus: "pending" },
        { ...readingsDocument(), id: "doc-failed", uploadStatus: "failed" },
      ],
      isLoading: false,
      error: null,
    });

    const html = renderToStaticMarkup(
      <ProductionReadingsDocuments productionRunId="run-1" />,
    );

    expect(html).toContain("0 files");
    expect(html).toContain("No readings files uploaded yet.");
    expect(html).not.toContain("reactor-original.csv");
  });
});
