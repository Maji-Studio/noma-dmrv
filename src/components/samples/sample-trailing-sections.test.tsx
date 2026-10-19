// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { UseDeferredAttachmentsResult } from "@/hooks/use-deferred-attachments";

vi.mock("@/hooks/use-record-certification-lock", () => ({ useIsRecordCertificationLocked: () => false }));
vi.mock("./sample-documents-panel", () => ({ SampleDocumentsPanel: () => null }));
vi.mock("@/components/transport-legs", () => ({ TransportLegsEditor: () => null }));
vi.mock("@/components/forms", () => ({
  FormSection: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  FormField: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  FormFileUpload: ({ id, onDeferredAdd }: { id: string; onDeferredAdd: (files: File[]) => void }) => (
    <input id={id} type="file" aria-label="Attach evidence" onChange={(event) => onDeferredAdd(Array.from(event.target.files ?? []))} />
  ),
}));
import { SampleEvidenceSection } from "./sample-trailing-sections";

afterEach(cleanup);
it("classifies each deferred file using the selection when it was attached", () => {
  const add = vi.fn();
  const deferred = { attachments: [], add, remove: vi.fn() } as unknown as UseDeferredAttachmentsResult;
  render(<SampleEvidenceSection isEditMode={false} deferredAttachments={deferred} />);
  const report = new File(["report"], "report.pdf", { type: "application/pdf" });
  const histogram = new File(["histogram"], "histogram.csv", { type: "text/csv" });
  fireEvent.change(screen.getByLabelText("Attach evidence"), { target: { files: [report] } });
  fireEvent.click(screen.getByRole("radio", { name: "Reflectance histogram" }));
  fireEvent.change(screen.getByLabelText("Attach evidence"), { target: { files: [histogram] } });
  expect(add.mock.calls).toEqual([[[report], "lab_report"], [[histogram], "reflectance_histogram"]]);
});
