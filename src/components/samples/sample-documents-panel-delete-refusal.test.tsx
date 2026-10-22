// @vitest-environment jsdom
/**
 * A refused document delete shows the server's reason inside the open
 * confirmation dialog, not on the page behind the modal.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const DOC = {
  id: "6f1c4d3a-0f2b-4d6a-9f1e-0a1b2c3d4e5f",
  fileName: "lab-report.pdf",
  documentType: "lab_report",
  fileSizeBytes: 2048,
  visibility: "private",
  uploadStatus: "uploaded",
  fileUrl: "https://example.test/lab-report.pdf",
  version: 2,
};
const REFUSAL = "This document is referenced by a certification review, so it cannot be deleted.";

const harness = vi.hoisted(() => ({ remove: vi.fn() }));

vi.mock("@/hooks/use-documents", () => ({
  documentKeys: { forEntity: () => ["documents"] },
  useCanChangeDocumentVisibility: () => false,
  useDocumentsForEntity: () => ({ data: [DOC], isLoading: false, error: null }),
  useSetDocumentVisibility: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useDeleteDocument: () => ({ isPending: false, mutateAsync: harness.remove }),
}));
vi.mock("@/hooks/use-record-certification-lock", () => ({ useIsRecordCertificationLocked: () => false }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/components/forms/form-file-upload", () => ({ FormFileUpload: () => null }));

import { SampleDocumentsPanel } from "./sample-documents-panel";

afterEach(cleanup);

describe("document delete refusal", () => {
  it("renders the refusal inside the open dialog, once, and clears it on cancel", async () => {
    harness.remove.mockRejectedValue(new Error(REFUSAL));
    render(<SampleDocumentsPanel sampleId="smp-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Delete lab-report.pdf" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByText(REFUSAL)).toBeNull();

    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Delete" })); });

    expect(within(screen.getByRole("dialog")).getByText(REFUSAL)).toBeTruthy();
    expect(screen.getAllByText(REFUSAL)).toHaveLength(1);

    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete lab-report.pdf" }));
    expect(screen.queryByText(REFUSAL)).toBeNull();
  });
});
