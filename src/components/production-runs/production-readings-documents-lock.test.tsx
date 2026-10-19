// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  useDocumentsForEntity: () => ({
    data: [
      {
        id: "document-1",
        fileName: "readings.csv",
        fileSizeBytes: 1000,
        uploadStatus: "uploaded",
        documentType: "sensor_data",
        mimeType: "text/csv",
      },
    ],
    error: null,
    isLoading: false,
  }),
}));
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: vi.fn() }),
}));
vi.mock("@/components/ui/delete-confirm-dialog", () => ({
  DeleteConfirmDialog: ({ isOpen, title }: { isOpen: boolean; title: string }) =>
    isOpen ? <div role="dialog" aria-label={title} /> : null,
}));
vi.mock("@/components/forms", () => ({
  ServerError: ({ message }: { message: string }) => <p>{message}</p>,
}));
vi.mock("@/components/forms/form-file-upload", () => ({
  FormFileUpload: () => <div data-testid="uploader" />,
}));

import type { UseDeferredAttachmentsResult } from "@/hooks/use-deferred-attachments";
import { ProductionReadingsDocuments } from "./production-readings-documents";

function failedAttachments(): UseDeferredAttachmentsResult {
  return {
    attachments: [{ key: "a1", file: new File(["x"], "queued.csv"), documentType: "sensor_data", status: "failed", error: "Upload failed." }],
    retry: vi.fn(),
    remove: vi.fn(),
  } as unknown as UseDeferredAttachmentsResult;
}

afterEach(cleanup);

describe("ProductionReadingsDocuments certification lock", () => {
  beforeEach(() => {
    mocks.locked = false;
    mocks.lockArgs = [];
  });

  it("keeps a locked run's readings files downloadable and hides every change control", () => {
    mocks.locked = true;
    render(<ProductionReadingsDocuments productionRunId="run-1" />);

    expect(mocks.lockArgs).toContainEqual(["production_run", "run-1"]);
    expect(screen.getByText(RECORD_FILES_LOCKED_MESSAGE)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open readings.csv" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete readings.csv" })).toBeNull();
    expect(screen.queryByTestId("uploader")).toBeNull();
  });

  it("is unchanged while the run is not locked", () => {
    render(<ProductionReadingsDocuments productionRunId="run-1" />);

    expect(screen.queryByText(RECORD_FILES_LOCKED_MESSAGE)).toBeNull();
    expect(screen.getByRole("button", { name: "Delete readings.csv" })).toBeTruthy();
    expect(screen.getByTestId("uploader")).toBeTruthy();
  });

  it("keeps failed queued uploads listed but offers no retry once locked", () => {
    mocks.locked = true;
    render(<ProductionReadingsDocuments productionRunId="run-1" deferredAttachments={failedAttachments()} />);

    expect(screen.getByText("1 attachment was not uploaded")).toBeTruthy();
    expect(screen.getByText("queued.csv")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  });

  it("offers retries for failed queued uploads while unlocked", () => {
    render(<ProductionReadingsDocuments productionRunId="run-1" deferredAttachments={failedAttachments()} />);

    expect(screen.getByRole("button", { name: "Retry uploads" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("closes an open delete confirmation when the lock resolves to locked", () => {
    const { rerender } = render(<ProductionReadingsDocuments productionRunId="run-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete readings.csv" }));
    expect(screen.getByRole("dialog", { name: "Delete readings file" })).toBeTruthy();

    mocks.locked = true;
    rerender(<ProductionReadingsDocuments productionRunId="run-1" />);

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
