import type { ButtonHTMLAttributes, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-certification-sources", () => ({
  useCandidateDocumentsForRemoval: () => ({
    data: {
      hasMapping: true,
      candidates: [
        {
          document: {
            id: "legacy-document-id",
            fileName: "legacy-boundary-logbook.PDF",
            documentType: "boundary_logbook",
            mimeType: null,
            storageKey: null,
          },
          lineageEntity: {
            entityLabel: "Application AP-26-001",
          },
          mirror: null,
        },
        {
          document: {
            id: "mime-pdf-document-id",
            fileName: "laboratory-report",
            documentType: "lab_report",
            mimeType: "application/pdf; charset=binary",
            storageKey: "samples/laboratory-report",
          },
          lineageEntity: {
            entityLabel: "Lab sample CB-26-001",
          },
          mirror: null,
        },
        {
          document: {
            id: "csv-document-id",
            fileName: "readings.csv",
            documentType: "sensor_data",
            mimeType: "text/csv",
            storageKey: "runs/readings.csv",
          },
          lineageEntity: {
            entityLabel: "Production run PR-26-001",
          },
          mirror: null,
        },
      ],
    },
    isLoading: false,
    error: null,
  }),
  useMirrorDocumentToSource: () => ({
    isPending: false,
    mutate: vi.fn(),
  }),
  useUnlinkDocumentSource: () => ({
    isPending: false,
    mutate: vi.fn(),
  }),
}));
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/components/ui", () => ({
  Button: ({
    children,
    busy: _busy,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    busy?: boolean;
    children?: ReactNode;
  }) => {
    void _busy;
    return (
      <button type="button" {...props}>
        {children}
      </button>
    );
  },
  EmptyState: () => null,
}));
vi.mock("@phosphor-icons/react/dist/ssr", () => ({
  CheckCircleIcon: () => null,
  CloudIcon: () => null,
  FileIcon: () => null,
  WarningCircleIcon: () => null,
}));
vi.mock("./panel-layout", () => ({
  Section: ({ children }: { children?: ReactNode }) => (
    <section>{children}</section>
  ),
}));

import { SourcesPanel } from "./sources-panel";

describe("SourcesPanel supporting document affordances", () => {
  it("renders legacy URL-only documents as a non-interactive status", () => {
    const html = renderToStaticMarkup(
      <SourcesPanel removalId="removal-id" />,
    );

    expect(html).toContain("No managed file bytes");
    expect(html).toContain("noma has no managed file bytes to copy");
    expect(html).not.toContain("Re-upload required");
  });

  it("previews PDFs through the authenticated document route only", () => {
    const html = renderToStaticMarkup(
      <SourcesPanel removalId="removal-id" />,
    );

    expect(html).toContain('href="/api/documents/legacy-document-id"');
    expect(html).toContain('href="/api/documents/mime-pdf-document-id"');
    expect(html).not.toContain('href="/api/documents/csv-document-id"');
    expect(html.match(/target="_blank"/g)).toHaveLength(2);
    expect(html.match(/rel="noopener noreferrer"/g)).toHaveLength(2);
    expect(html).not.toContain("signed");
  });

  it("has no per-file registry visibility controls", () => {
    const html = renderToStaticMarkup(
      <SourcesPanel removalId="removal-id" />,
    );

    expect(html).not.toContain("Private");
    expect(html).not.toContain("Public");
    expect(html).not.toContain("aria-pressed");
  });
});
