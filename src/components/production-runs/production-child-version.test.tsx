import type { ButtonHTMLAttributes, ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { STALE_VERSION_CONFLICT_CODE, STALE_VERSION_MESSAGE, StaleVersionError, staleDeleteMessage } from "@/lib/stale-version";

const state = vi.hoisted(() => ({ row: { id: "child", version: 1, incidentTime: new Date("2026-09-01T12:00:00Z"), timestamp: new Date("2026-09-01T12:00:00Z") }, save: vi.fn(), remove: vi.fn(), toast: vi.fn() }));
vi.mock("@/hooks/use-production-incidents", () => ({
  useProductionIncidents: () => ({ data: [state.row] }), useCreateProductionIncident: () => ({}),
  useUpdateProductionIncident: () => ({ mutateAsync: state.save }), useDeleteProductionIncident: () => ({ mutateAsync: state.remove }),
}));
vi.mock("@/hooks/use-production-samples", () => ({
  useProductionSamples: () => ({ data: [state.row] }), useCreateProductionSample: () => ({}),
  useUpdateProductionSample: () => ({ mutateAsync: state.save }), useDeleteProductionSample: () => ({ mutateAsync: state.remove }),
}));
vi.mock("@/hooks/use-create-with-evidence", () => ({ useCreateWithEvidence: () => ({ deferredAttachments: { attachments: [] }, guardUpdate: () => false, reset: vi.fn() }) }));
vi.mock("@/components/ui", () => ({ Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} /> }));
vi.mock("@/components/forms", () => ({ ServerError: () => null }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ error: state.toast, success: vi.fn() }) }));
vi.mock("@/components/forms/entity-select/quick-add-dialog-shell", () => ({ QuickAddDialogShell: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/ui/delete-confirm-dialog", () => ({ DeleteConfirmDialog: ({ isOpen, onConfirm }: { isOpen: boolean; onConfirm: () => void }) => isOpen ? <button aria-label="Confirm delete" onClick={onConfirm} /> : null }));
interface FormProps { onSubmit: (input: object) => Promise<void>; errorMessage?: string; }
vi.mock("./production-incident-form", () => ({ ProductionIncidentForm: ({ onSubmit, errorMessage }: FormProps) => <form data-error={errorMessage}><button aria-label="Save draft" onClick={() => onSubmit({ notes: "Operator draft" })} /></form> }));
vi.mock("./production-sample-form", () => ({ ProductionSampleForm: ({ onSubmit, errorMessage }: FormProps) => <form data-error={errorMessage}><button aria-label="Save draft" onClick={() => onSubmit({ notes: "Operator draft" })} /></form> }));
import { ProductionIncidentTable } from "./production-incident-table";
import { ProductionSampleTable } from "./production-sample-table";

const INITIAL_VERSION = 1;
const NEW_VERSION = 2;
const refusal = new StaleVersionError(STALE_VERSION_MESSAGE, { entity: "productionIncident", id: "child", code: STALE_VERSION_CONFLICT_CODE });
beforeEach(() => {
  vi.clearAllMocks();
  state.row = { ...state.row, version: INITIAL_VERSION };
  state.save.mockRejectedValue(refusal);
  state.remove.mockRejectedValue(refusal);
});
for (const [label, title, idKey, Component] of [
  ["incident", "Incident", "productionIncidentId", ProductionIncidentTable],
  ["in-process measurement", "In-process measurement", "productionSampleId", ProductionSampleTable],
] as const) {
  describe(label, () => {
    it("keeps the draft and its opening version after a refetch and stale refusal", async () => {
      let renderer!: ReactTestRenderer;
      await act(async () => { renderer = create(<Component productionRunId="run" />); });
      try {
        await act(async () => { renderer.root.findByProps({ "aria-label": `Edit ${label}` }).props.onClick(); });
        state.row = { ...state.row, version: NEW_VERSION };
        await act(async () => { renderer.update(<Component productionRunId="run" />); });
        await act(async () => { await renderer.root.findByProps({ "aria-label": "Save draft" }).props.onClick(); });
        expect(state.save).toHaveBeenCalledWith({ [idKey]: "child", expectedVersion: INITIAL_VERSION, notes: "Operator draft" });
        expect(renderer.root.findByType("form").props["data-error"]).toBe(STALE_VERSION_MESSAGE);
      } finally { await act(async () => renderer.unmount()); }
    });
    it("uses the confirmation's loaded version and explains a stale delete", async () => {
      let renderer!: ReactTestRenderer;
      await act(async () => { renderer = create(<Component productionRunId="run" />); });
      try {
        await act(async () => { renderer.root.findByProps({ "aria-label": `Delete ${label}` }).props.onClick(); });
        state.row = { ...state.row, version: NEW_VERSION };
        await act(async () => { renderer.update(<Component productionRunId="run" />); });
        await act(async () => { await renderer.root.findByProps({ "aria-label": "Confirm delete" }).props.onClick(); });
        expect(state.remove).toHaveBeenCalledWith({ [idKey]: "child", expectedVersion: INITIAL_VERSION });
        expect(state.toast).toHaveBeenCalledWith(staleDeleteMessage(title));
      } finally { await act(async () => renderer.unmount()); }
    });
  });
}
