// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RECORD_FILES_LOCKED_MESSAGE } from "@/lib/certification/lineage-lock-message";

const mocks = vi.hoisted(() => ({ remove: vi.fn(), visibility: vi.fn(), version: 7, role: "owner" as string | null, platformAdmin: false, locked: false, lockArgs: [] as unknown[][] }));

vi.mock("@/hooks/use-record-certification-lock", () => ({
  useIsRecordCertificationLocked: (...args: unknown[]) => {
    mocks.lockArgs.push(args);
    return mocks.locked;
  },
}));
vi.mock("@/hooks/use-documents", () => ({
  useCanChangeDocumentVisibility: () => mocks.platformAdmin || ["owner", "admin"].includes(mocks.role ?? ""),
  documentKeys: { forEntity: () => ["documents"] },
  useDeleteDocument: () => ({ isPending: false, mutateAsync: mocks.remove }),
  useSetDocumentVisibility: () => ({ isPending: false, mutateAsync: mocks.visibility }),
  useDocumentsForEntity: () => ({
    data: [
      {
        id: "document-1", version: mocks.version,
        fileName: "lab.pdf",
        fileSizeBytes: 1000,
        uploadStatus: "uploaded",
        documentType: "lab_report",
        visibility: "private",
      },
    ],
    error: null,
    isLoading: false,
  }),
}));
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/components/ui/delete-confirm-dialog", () => ({
  DeleteConfirmDialog: ({ onConfirm }: { onConfirm: () => void }) => <button onClick={onConfirm}>Confirm delete</button>,
}));
vi.mock("@/components/forms", () => ({
  FormField: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ServerError: ({ message }: { message: string }) => <p>{message}</p>,
}));
vi.mock("@/components/forms/form-file-upload", () => ({
  FormFileUpload: ({ documentType }: { documentType: string }) => <div data-testid="uploader" data-document-type={documentType} />,
}));

import { SampleDocumentsPanel } from "./sample-documents-panel";

afterEach(cleanup);

describe("SampleDocumentsPanel certification lock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.version = 7;
    mocks.role = "owner";
    mocks.platformAdmin = false;
    mocks.locked = false;
    mocks.lockArgs = [];
  });

  it("keeps a locked sample's files downloadable and hides every change control", () => {
    mocks.locked = true;
    render(<SampleDocumentsPanel sampleId="sample-1" />);

    expect(mocks.lockArgs).toContainEqual(["sample", "sample-1"]);
    expect(screen.getByText(RECORD_FILES_LOCKED_MESSAGE)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open lab.pdf" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete lab.pdf" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Make public" })).toBeNull();
    expect(screen.queryByTestId("uploader")).toBeNull();
  });

  it.each([
    ["owner", false, true], ["admin", false, true], ["member", false, false],
    [null, true, true], [null, false, false],
  ] as const)("gates visibility for role=%s platformAdmin=%s", (role, platformAdmin, allowed) => {
    mocks.role = role;
    mocks.platformAdmin = platformAdmin;
    render(<SampleDocumentsPanel sampleId="sample-1" />);
    expect(!!screen.queryByRole("button", { name: "Make public" })).toBe(allowed);
    expect(screen.getByRole("button", { name: "Delete lab.pdf" })).toBeTruthy();
  });

  it("is unchanged while the sample is not locked", () => {
    render(<SampleDocumentsPanel sampleId="sample-1" />);

    expect(screen.queryByText(RECORD_FILES_LOCKED_MESSAGE)).toBeNull();
    expect(screen.getByRole("button", { name: "Delete lab.pdf" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Make public" })).toBeTruthy();
    expect(screen.getByTestId("uploader")).toBeTruthy();
  });
});

it("sends the listed version on visibility and retains the deletion version while the list refreshes", async () => {
  mocks.version = 7; mocks.role = "owner"; mocks.locked = false;
  vi.clearAllMocks();
  const view = render(<SampleDocumentsPanel sampleId="sample-1" />);
  fireEvent.click(screen.getByRole("button", { name: "Make public" }));
  await waitFor(() => expect(mocks.visibility).toHaveBeenCalledWith({ documentId: "document-1", expectedVersion: 7, visibility: "public" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete lab.pdf" }));
  mocks.version = 8;
  view.rerender(<SampleDocumentsPanel sampleId="sample-1" />);
  fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
  await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith({ documentId: "document-1", expectedVersion: 7 }));
});

it("lets operators choose a reflectance histogram for a Sample upload", () => {
  mocks.locked = false;
  render(<SampleDocumentsPanel sampleId="sample-1" />);
  fireEvent.click(screen.getByRole("radio", { name: "Reflectance histogram" }));
  expect(screen.getByTestId("uploader").getAttribute("data-document-type")).toBe("reflectance_histogram");
});
