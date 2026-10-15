// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RECORD_FILES_LOCKED_MESSAGE } from "@/lib/certification/lineage-lock-message";

const mocks = vi.hoisted(() => ({ locked: false, lockArgs: [] as unknown[][] }));

vi.mock("@/hooks/use-record-certification-lock", () => ({
  useIsRecordCertificationLocked: (...args: unknown[]) => {
    mocks.lockArgs.push(args);
    return mocks.locked;
  },
}));
vi.mock("@/hooks/use-documents", () => ({
  documentKeys: { forEntity: () => ["documents"] },
  useDeleteDocument: () => ({ isPending: false }),
  useSetDocumentVisibility: () => ({ isPending: false }),
  useDocumentsForEntity: () => ({
    data: [
      {
        id: "document-1",
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
  DeleteConfirmDialog: () => null,
}));
vi.mock("@/components/forms", () => ({
  FormField: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ServerError: ({ message }: { message: string }) => <p>{message}</p>,
}));
vi.mock("@/components/forms/form-file-upload", () => ({
  FormFileUpload: () => <div data-testid="uploader" />,
}));

import { SampleDocumentsPanel } from "./sample-documents-panel";

afterEach(cleanup);

describe("SampleDocumentsPanel certification lock", () => {
  beforeEach(() => {
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

  it("is unchanged while the sample is not locked", () => {
    render(<SampleDocumentsPanel sampleId="sample-1" />);

    expect(screen.queryByText(RECORD_FILES_LOCKED_MESSAGE)).toBeNull();
    expect(screen.getByRole("button", { name: "Delete lab.pdf" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Make public" })).toBeTruthy();
    expect(screen.getByTestId("uploader")).toBeTruthy();
  });
});
