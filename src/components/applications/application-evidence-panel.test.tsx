import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DocumentRow } from "@/data-access/documents";
import type { ApplicationEvidenceMethod } from "@/schemas/applications";
import type { GisBoundary } from "@/schemas/gis-boundary";
import { TEST_GIS_BOUNDARY } from "../../../tests/helpers/application-evidence-fixtures";

const documentsForEntity = vi.fn();

vi.mock("@/hooks/use-documents", () => ({
  documentKeys: { forEntity: (type: string, id: string) => [type, id] },
  useDeleteDocument: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useDocumentsForEntity: (...args: unknown[]) => documentsForEntity(...args),
}));
vi.mock("@/hooks/use-applications", () => ({
  applicationKeys: { lists: () => ["applications", "list"] },
}));
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: vi.fn() }),
}));
vi.mock("@/components/forms", () => ({
  FormFileUpload: ({
    accept,
    documentType,
    resolveDocumentType,
  }: {
    accept?: string;
    documentType?: string;
    resolveDocumentType?: (file: File) => string;
  }) => (
    <div
      data-testid="file-upload"
      data-accept={accept}
      data-document-type={documentType}
      data-resolves-document-type={!!resolveDocumentType}
    />
  ),
  ServerError: ({ message }: { message: string }) => <p>{message}</p>,
}));
vi.mock("@/components/forms/failed-deferred-attachments", () => ({
  FailedDeferredAttachments: () => null,
}));
vi.mock("@/components/ui/delete-confirm-dialog", () => ({
  DeleteConfirmDialog: () => null,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children?: ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));
vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: () => null,
}));

import { ApplicationEvidencePanel } from "./application-evidence-panel";
import { ApplicationSupportingEvidencePanel } from "./application-supporting-evidence-panel";

const APPLICATION_ID = "11111111-1111-4111-8111-111111111111";

function boundaryDoc(logbookEvidenceType: string | null): DocumentRow {
  return {
    id: "doc-1",
    fileName: "logbook.pdf",
    fileSizeBytes: 1024,
    fileUrl: "/files/doc-1",
    documentType: "pdf",
    uploadStatus: "uploaded",
    capturedAt: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    metadata: logbookEvidenceType ? { logbookEvidenceType } : {},
  } as unknown as DocumentRow;
}

function imageDoc(): DocumentRow {
  return {
    id: "image-doc-1",
    fileName: "application.jpg",
    fileSizeBytes: 2048,
    fileUrl: "/files/image-doc-1",
    documentType: "photo",
    uploadStatus: "uploaded",
    capturedAt: new Date("2026-07-01T00:00:00.000Z"),
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    metadata: { geotagStatus: "present" },
  } as unknown as DocumentRow;
}

function renderPanel(
  docs: DocumentRow[],
  mode: ApplicationEvidenceMethod = "location",
  boundary: GisBoundary | null = null,
  readOnly = false,
): string {
  documentsForEntity.mockReturnValue({
    data: docs,
    isLoading: false,
    error: null,
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <ApplicationEvidencePanel
        mode={mode}
        boundary={boundary}
        readOnly={readOnly}
      />
    </QueryClientProvider>,
  );
}

function renderSupportingEvidencePanel(
  docs: DocumentRow[],
  readOnly = false,
): string {
  documentsForEntity.mockReturnValue({
    data: docs,
    isLoading: false,
    error: null,
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <ApplicationSupportingEvidencePanel
        applicationId={APPLICATION_ID}
        readOnly={readOnly}
      />
    </QueryClientProvider>,
  );
}

describe("ApplicationEvidencePanel", () => {
  it("shows customer location first and selects it by default", () => {
    const html = renderPanel([]);

    expect(html.indexOf("Customer location")).toBeLessThan(
      html.indexOf("GIS reference"),
    );
    expect(html).toContain("Visual evidence");
    expect(html).toContain("Available later");
    const selectedCard = html.match(
      /<button[^>]*role="radio"[^>]*aria-checked="true"[^>]*>[\s\S]*?<\/button>/,
    )?.[0];
    expect(selectedCard).toContain("Customer location");
    expect(html).not.toContain("Add GIS reference");
  });

  it("preserves a saved visual evidence method as unavailable", () => {
    const html = renderPanel([], "visual");
    const visualCard = html.match(
      /<div[^>]*role="radio"[^>]*aria-checked="true"[^>]*aria-disabled="true"[^>]*>[\s\S]*?<\/div>/,
    )?.[0];

    expect(visualCard).toContain("Visual evidence");
  });

  it("only shows the GIS editor for GIS reference evidence", () => {
    expect(renderPanel([], "boundary")).toContain("Add GIS reference");
    expect(renderPanel([], "location")).not.toContain("Add GIS reference");
  });

  it("keeps the saved GIS reference actions in edit mode", () => {
    const html = renderPanel([], "boundary", TEST_GIS_BOUNDARY);

    expect(html).toContain("Replace");
    expect(html).toContain("Remove");
    expect(html).not.toContain("Add GIS reference");
  });

  it("keeps the missing GIS reference empty state in read mode", () => {
    const html = renderPanel([], "boundary", null, true);

    expect(html).toContain("No GIS reference");
    expect(html).not.toContain("Add GIS reference");
  });

  it("does not mix supporting files into the evidence method", () => {
    const html = renderPanel(
      [boundaryDoc("affidavit"), imageDoc()],
      "boundary",
    );

    expect(html).not.toContain("Application mass records");
    expect(html).not.toContain("logbook.pdf");
    expect(html).not.toContain("application.jpg");
    expect(html).not.toContain("Record type for the next upload");
    expect(html).not.toContain("Affidavit");
    expect(html).not.toContain("Classify logbook");
  });
});

describe("ApplicationSupportingEvidencePanel", () => {
  it("uses one upload field for images and application documents", () => {
    const html = renderSupportingEvidencePanel([boundaryDoc(null), imageDoc()]);

    expect(html).toContain("application.jpg");
    expect(html).toContain("logbook.pdf");
    expect(html.match(/data-testid="file-upload"/g)).toHaveLength(1);
    expect(html).toContain(
      'data-accept="image/*,application/pdf,.pdf"',
    );
    expect(html).toContain('data-resolves-document-type="true"');
    expect(html).toContain("Images and PDFs");
    expect(html).not.toContain("They are sent to Isometric as Sources");
    expect(html).not.toContain("No supporting evidence attached yet.");
  });

  it("shows supporting evidence without uploaders in read mode", () => {
    const html = renderSupportingEvidencePanel([], true);

    expect(html).toContain("No supporting evidence attached yet.");
    expect(html).not.toContain('data-testid="file-upload"');
  });
});
