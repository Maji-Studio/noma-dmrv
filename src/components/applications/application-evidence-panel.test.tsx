import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DocumentRow } from "@/data-access/documents";
import type { ApplicationEvidenceMethod } from "@/schemas/applications";

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
  FormFileUpload: () => <div data-testid="file-upload" />,
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

function renderPanel(
  docs: DocumentRow[],
  mode: ApplicationEvidenceMethod = "location",
): string {
  documentsForEntity.mockReturnValue({
    data: docs,
    isLoading: false,
    error: null,
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <ApplicationEvidencePanel
        applicationId={APPLICATION_ID}
        mode={mode}
        boundary={null}
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
    expect(html.indexOf("GIS reference")).toBeLessThan(
      html.indexOf("Visual evidence"),
    );
    const selectedCard = html.match(
      /<button[^>]*role="radio"[^>]*aria-checked="true"[^>]*>[\s\S]*?<\/button>/,
    )?.[0];
    expect(selectedCard).toContain("Customer location");
    expect(html).not.toContain("Add GIS reference");
  });

  it("only shows the GIS editor for GIS reference evidence", () => {
    expect(renderPanel([], "boundary")).toContain("Add GIS reference");
    expect(renderPanel([], "location")).not.toContain("Add GIS reference");
  });

  it("keeps visual evidence visible but locked", () => {
    const html = renderPanel([]);

    expect(html).toContain("Visual evidence");
    expect(html).toContain("Available later");
    expect(html).toMatch(
      /role="radio"[^>]*aria-checked="false"[^>]*aria-disabled="true"/,
    );
  });

  it("keeps mass records without showing the obsolete type taxonomy", () => {
    const html = renderPanel([boundaryDoc("affidavit")], "boundary");

    expect(html).toContain("Application mass records");
    expect(html).toContain("logbook.pdf");
    expect(html).not.toContain("Record type for the next upload");
    expect(html).not.toContain("Affidavit");
    expect(html).not.toContain("Classify logbook");
  });
});
