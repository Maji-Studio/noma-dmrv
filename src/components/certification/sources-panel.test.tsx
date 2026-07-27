import type { ButtonHTMLAttributes, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rowMutationState = vi.hoisted(() => ({
  isPending: false,
  isError: false,
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
  useMirrorDocumentToSource: () => ({
    isPending: rowMutationState.isPending,
    isError: rowMutationState.isError,
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

import {
  canStartSourceMirror,
  deriveSourceRowState,
  SourcesPanel,
} from "./sources-panel";

describe("SourcesPanel supporting document affordances", () => {
  beforeEach(() => {
    rowMutationState.isPending = false;
    rowMutationState.isError = false;
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

  it.each([
    [{ hasConfirmedMapping: false, isPending: false, isError: false }, "idle"],
    [{ hasConfirmedMapping: false, isPending: true, isError: false }, "pending"],
    [{ hasConfirmedMapping: true, isPending: false, isError: false }, "success"],
    [{ hasConfirmedMapping: false, isPending: false, isError: true }, "failure"],
    // An ambiguous failed response reconciled to a persisted mapping is success.
    [{ hasConfirmedMapping: true, isPending: false, isError: true }, "success"],
  ] as const)("derives deterministic row state %#", (input, expected) => {
    expect(deriveSourceRowState(input)).toBe(expected);
  });

  it("prevents duplicate mirror actions while a row is pending", () => {
    expect(canStartSourceMirror("pending")).toBe(false);
    expect(canStartSourceMirror("idle")).toBe(true);
    expect(canStartSourceMirror("failure")).toBe(true);
  });

  it("shows only the slow row as pending and disables its action", () => {
    rowMutationState.isPending = true;
    const html = renderToStaticMarkup(
      <SourcesPanel removalId="removal-id" isEditable />,
    );

    expect(html).toContain("Pending");
    expect(html).toContain("disabled");
  });

  it("shows Retry only after a reconciled failure remains unconfirmed", () => {
    rowMutationState.isError = true;
    const html = renderToStaticMarkup(
      <SourcesPanel removalId="removal-id" isEditable />,
    );

    expect(html).toContain("Retry");
  });

  it("treats an ambiguous response reconciled to a mapping as success", () => {
    rowMutationState.isError = true;
    rowMutationState.confirmed = true;
    const html = renderToStaticMarkup(
      <SourcesPanel removalId="removal-id" isEditable />,
    );

    expect(html).toContain("source-confirmed");
    expect(html).not.toContain("Retry");
  });

  it("surfaces a background refetch failure instead of stale cached data", () => {
    queryState.isError = true;

    const html = renderToStaticMarkup(
      <SourcesPanel removalId="removal-id" isEditable />,
    );

    expect(html).toContain("Unable to load supporting sources");
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
