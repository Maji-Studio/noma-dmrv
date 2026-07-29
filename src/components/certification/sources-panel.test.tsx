import type { ButtonHTMLAttributes, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rowMutationState = vi.hoisted(() => ({
  confirmed: false,
}));
const queryState = vi.hoisted(() => ({
  isError: false,
}));

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
          binding: {
            nomaRole: "inventory",
            nomaRoleLabel: "Inventory",
          },
          mirror: rowMutationState.confirmed
            ? {
                externalDocumentId: "source-confirmed",
                isPublic: false,
                mirroredAt: new Date("2026-07-27T00:00:00.000Z"),
              }
            : null,
        },
        {
          document: {
            id: "mime-pdf-document-id",
            fileName: "delivery-bol",
            documentType: "bill_of_lading",
            mimeType: "application/pdf; charset=binary",
            storageKey: "deliveries/delivery-bol",
          },
          lineageEntity: {
            entityLabel: "Delivery DEL-26-001",
          },
          binding: {
            nomaRole: "delivery_bill_of_lading",
            nomaRoleLabel: "Delivery bill of lading",
          },
          mirror: rowMutationState.confirmed
            ? {
                externalDocumentId: "source-confirmed",
                isPublic: false,
                mirroredAt: new Date("2026-07-27T00:00:00.000Z"),
              }
            : null,
        },
        {
          document: {
            id: "feedstock-document-id",
            fileName: "feedstock-bol.csv",
            documentType: "bill_of_lading",
            mimeType: "text/csv",
            storageKey: "feedstocks/feedstock-bol.csv",
          },
          lineageEntity: {
            entityLabel: "Feedstock FS-26-001",
          },
          binding: {
            nomaRole: "feedstock_bill_of_lading",
            nomaRoleLabel: "Feedstock bill of lading",
          },
          mirror: rowMutationState.confirmed
            ? {
                externalDocumentId: "source-confirmed",
                isPublic: false,
                mirroredAt: new Date("2026-07-27T00:00:00.000Z"),
              }
            : null,
        },
      ],
    },
    isLoading: false,
    isError: queryState.isError,
    error: queryState.isError ? new Error("background refetch failed") : null,
  }),
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

import {
  SourcesPanel,
} from "./sources-panel";

describe("SourcesPanel supporting document affordances", () => {
  beforeEach(() => {
    rowMutationState.confirmed = false;
    queryState.isError = false;
  });

  it("renders legacy URL-only documents as a non-interactive status", () => {
    const html = renderToStaticMarkup(
      <SourcesPanel removalId="removal-id" isEditable />,
    );

    expect(html).toContain("No managed file bytes");
    expect(html).toContain("noma has no managed file bytes to copy");
    expect(html).not.toContain("Re-upload required");
  });

  it("previews PDFs through the authenticated document route only", () => {
    const html = renderToStaticMarkup(
      <SourcesPanel removalId="removal-id" isEditable />,
    );

    expect(html).toContain('href="/api/documents/legacy-document-id"');
    expect(html).toContain('href="/api/documents/mime-pdf-document-id"');
    expect(html).not.toContain('href="/api/documents/feedstock-document-id"');
    expect(html.match(/target="_blank"/g)).toHaveLength(2);
    expect(html.match(/rel="noopener noreferrer"/g)).toHaveLength(2);
    expect(html).not.toContain("signed");
  });

  it("has no per-file registry visibility controls", () => {
    const html = renderToStaticMarkup(
      <SourcesPanel removalId="removal-id" isEditable />,
    );

    expect(html).not.toContain("Private");
    expect(html).not.toContain("Public");
    expect(html).not.toContain("aria-pressed");
  });

  it("shows managed files as automatic submit work with no per-file action", () => {
    const html = renderToStaticMarkup(
      <SourcesPanel removalId="removal-id" isEditable />,
    );

    expect(html.match(/On submit/g)).toHaveLength(2);
    expect(html).toContain("3 files linked");
    expect(html).not.toContain(">Mirror<");
    expect(html).not.toContain(">Retry<");
    expect(html).not.toContain("<button");
  });

  it("shows persisted mappings as ready", () => {
    rowMutationState.confirmed = true;
    const html = renderToStaticMarkup(
      <SourcesPanel removalId="removal-id" isEditable />,
    );

    expect(html.match(/>Ready<\/span>/g)).toHaveLength(3);
    expect(html).not.toContain("On submit");
  });

  it("surfaces a background refetch failure instead of stale cached data", () => {
    queryState.isError = true;

    const html = renderToStaticMarkup(
      <SourcesPanel removalId="removal-id" isEditable />,
    );

    expect(html).toContain(
      "Registry value sources could not be loaded. Refresh the page and try again.",
    );
    expect(html).not.toContain("legacy-boundary-logbook.PDF");
  });

  it("keeps submitted removal sources status-only", () => {
    const html = renderToStaticMarkup(
      <SourcesPanel removalId="removal-id" isEditable={false} />,
    );

    expect(html).toContain("Not mirrored");
    expect(html).not.toContain(">Mirror<");
    expect(html).not.toContain("Unlink locally");
  });

});
