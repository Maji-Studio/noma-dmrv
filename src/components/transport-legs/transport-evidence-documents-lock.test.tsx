// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RECORD_FILES_LOCKED_MESSAGE } from "@/lib/certification/lineage-lock-message";

const mocks = vi.hoisted(() => ({
  locked: false,
  lockArgs: [] as unknown[][],
}));

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
        fileName: "ticket.pdf",
        fileSizeBytes: 1000,
        uploadStatus: "uploaded",
        documentType: "weighbridge_ticket",
        metadata: {},
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
  DeleteConfirmDialog: () => null,
}));
vi.mock("./classified-transport-evidence-uploader", () => ({
  ClassifiedTransportEvidenceUploader: () => <div data-testid="uploader" />,
  evidenceUploaderLabel: () => "Weigh-scale ticket",
}));

import { TransportEvidencePanel } from "./transport-evidence-documents";

afterEach(cleanup);

describe("TransportEvidencePanel certification lock", () => {
  beforeEach(() => {
    mocks.locked = false;
    mocks.lockArgs = [];
  });

  it.each(["delivery", "feedstock", "transport_leg"] as const)(
    "keeps a locked %s's files downloadable and hides every change control",
    (entityType) => {
      mocks.locked = true;
      render(<TransportEvidencePanel entityType={entityType} entityId="owner-1" embedded />);

      expect(mocks.lockArgs).toContainEqual([entityType, "owner-1"]);
      expect(screen.getByText(RECORD_FILES_LOCKED_MESSAGE)).toBeTruthy();
      expect(screen.getByRole("link", { name: "Open ticket.pdf" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Delete ticket.pdf" })).toBeNull();
      expect(screen.queryByTestId("uploader")).toBeNull();
    },
  );

  it("is unchanged while the record is not locked", () => {
    render(<TransportEvidencePanel entityType="delivery" entityId="owner-1" embedded />);

    expect(screen.queryByText(RECORD_FILES_LOCKED_MESSAGE)).toBeNull();
    expect(screen.getByRole("button", { name: "Delete ticket.pdf" })).toBeTruthy();
    expect(screen.getByTestId("uploader")).toBeTruthy();
  });
});
