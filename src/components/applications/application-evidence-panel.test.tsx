import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DocumentRow } from "@/data-access/documents";

const documentsForEntity = vi.fn();

vi.mock("@/hooks/use-documents", () => ({
  documentKeys: { forEntity: (type: string, id: string) => [type, id] },
  useDeleteDocument: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useDocumentsForEntity: (...args: unknown[]) => documentsForEntity(...args),
  useUpdateApplicationEvidenceMetadata: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-applications", () => ({
  applicationKeys: { lists: () => ["applications", "list"] },
}));
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: vi.fn() }),
}));
vi.mock("@/components/forms", () => ({
  FormFileUpload: () => <div data-testid="file-upload" />,
  FormSelect: ({ value }: { value?: string }) => (
    <select data-testid="doc-type-select" defaultValue={value} />
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

import {
  ApplicationEvidencePanel,
  savedLogbookEvidenceType,
} from "./application-evidence-panel";

const APPLICATION_ID = "11111111-1111-4111-8111-111111111111";

function boundaryDoc(
  logbookEvidenceType: string | null,
  id = "doc-1",
  createdAt = new Date("2026-07-01T00:00:00.000Z"),
): DocumentRow {
  return {
    id,
    fileName: "logbook.pdf",
    fileSizeBytes: 1024,
    fileUrl: `/files/${id}`,
    documentType: "pdf",
    uploadStatus: "uploaded",
    capturedAt: null,
    createdAt,
    metadata: logbookEvidenceType ? { logbookEvidenceType } : {},
  } as unknown as DocumentRow;
}

function renderPanel(docs: DocumentRow[]): string {
  documentsForEntity.mockReturnValue({
    data: docs,
    isLoading: false,
    error: null,
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <ApplicationEvidencePanel
        applicationId={APPLICATION_ID}
        mode="boundary"
        boundary={null}
      />
    </QueryClientProvider>,
  );
}

/** The radio input markup for one evidence type, checked or not. */
function radioFor(html: string, type: string): string | undefined {
  return html.match(new RegExp(`<input[^>]*value="${type}"[^>]*>`))?.[0];
}

describe("savedLogbookEvidenceType", () => {
  it("returns null when no boundary document carries a classification", () => {
    expect(savedLogbookEvidenceType([])).toBeNull();
    expect(savedLogbookEvidenceType([boundaryDoc(null)])).toBeNull();
  });

  it("ignores unrecognised metadata values", () => {
    expect(savedLogbookEvidenceType([boundaryDoc("not-a-type")])).toBeNull();
  });

  it("returns the most recently saved classification, whatever the row order", () => {
    const older = new Date("2026-07-01T00:00:00.000Z");
    const newer = new Date("2026-07-09T00:00:00.000Z");

    expect(
      savedLogbookEvidenceType([
        boundaryDoc(null, "a", newer),
        boundaryDoc("affidavit", "b", older),
        boundaryDoc("inventory", "c", newer),
      ]),
    ).toBe("inventory");
    expect(
      savedLogbookEvidenceType([
        boundaryDoc("inventory", "c", newer),
        boundaryDoc("affidavit", "b", older),
      ]),
    ).toBe("inventory");
  });

  it("falls back to the first classification when timestamps cannot order the rows", () => {
    expect(
      savedLogbookEvidenceType([
        boundaryDoc("affidavit", "b", new Date(Number.NaN)),
        boundaryDoc("inventory", "c", new Date(Number.NaN)),
      ]),
    ).toBe("affidavit");
  });
});

describe("ApplicationEvidencePanel boundary evidence type", () => {
  it("keeps visual evidence visible but locked", () => {
    const html = renderPanel([]);

    expect(html).toContain("Visual evidence");
    expect(html).toContain("Available later");
    expect(html).toMatch(
      /role="radio"[^>]*aria-checked="false"[^>]*aria-disabled="true"/,
    );
  });

  it("initialises the upload-type radio from the saved evidence", () => {
    const html = renderPanel([boundaryDoc("affidavit")]);

    expect(radioFor(html, "affidavit")).toContain("checked");
    expect(radioFor(html, "weighbridge")).not.toContain("checked");
  });

  it("falls back to weighbridge when nothing is classified yet", () => {
    const html = renderPanel([]);

    expect(radioFor(html, "weighbridge")).toContain("checked");
    expect(radioFor(html, "affidavit")).not.toContain("checked");
  });

  it("labels the radio group as applying to the next upload only", () => {
    const html = renderPanel([boundaryDoc("affidavit")]);

    expect(html).toContain("Record type for the next upload");
    expect(html).toContain(
      'aria-label="Logbook evidence type for the next upload"',
    );
  });
});
