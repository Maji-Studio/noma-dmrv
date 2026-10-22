// @vitest-environment jsdom
/**
 * A refused supporting-evidence delete shows the server's reason inside the
 * open dialog, and a refusal from an earlier dialog does not carry over.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const DOC = { id: "6f1c4d3a-0f2b-4d6a-9f1e-0a1b2c3d4e5f", documentType: "gis_boundary", version: 2 };
const REFUSAL = "This file is referenced by a certification review, so it cannot be deleted.";

const harness = vi.hoisted(() => ({ remove: vi.fn() }));

vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("@/hooks/use-applications", () => ({ applicationKeys: { lists: () => ["applications"] } }));
vi.mock("@/hooks/use-documents", () => ({
  documentKeys: { forEntity: () => ["documents"] },
  useDocumentsForEntity: () => ({ data: [DOC], isLoading: false, error: null }),
  useDeleteDocument: () => ({ isPending: false, mutateAsync: harness.remove }),
}));
vi.mock("@/hooks/use-record-certification-lock", () => ({ useIsRecordCertificationLocked: () => false }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/components/forms", () => ({
  FormField: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  FormFileUpload: () => null,
  ServerError: ({ message }: { message?: string }) => (message ? <p>{message}</p> : null),
}));
vi.mock("@/components/forms/failed-deferred-attachments", () => ({ FailedDeferredAttachments: () => null }));
vi.mock("@/lib/certification/application-evidence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/certification/application-evidence")>()),
  isApplicationEvidenceDocumentReady: () => true,
}));
vi.mock("./application-evidence-document-list", () => ({
  ApplicationEvidenceDocumentList: ({ docs, onDelete }: { docs: Array<{ id: string }>; onDelete?: (id: string) => void }) => (
    <div>{docs.map((doc) => <button key={doc.id} type="button" onClick={() => onDelete?.(doc.id)}>Remove file</button>)}</div>
  ),
}));

import { ApplicationSupportingEvidencePanel } from "./application-supporting-evidence-panel";

afterEach(cleanup);

describe("supporting evidence delete refusal", () => {
  it("renders the refusal inside the dialog once, and not in the next dialog", async () => {
    harness.remove.mockRejectedValue(new Error(REFUSAL));
    render(<ApplicationSupportingEvidencePanel applicationId="app-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Remove file" }));
    await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" })); });

    expect(within(screen.getByRole("dialog")).getByText(REFUSAL)).toBeTruthy();
    expect(screen.getAllByText(REFUSAL)).toHaveLength(1);

    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove file" }));
    expect(screen.queryByText(REFUSAL)).toBeNull();
  });
});
