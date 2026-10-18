// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { FormActions } from "@/components/forms/form-actions";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SideSheetActionsContext, useSideSheetActions } from "@/components/ui/entity-side-sheet/side-sheet-context";
import * as detailPanel from "@/components/ui/detail-panel";
import * as storageLocationReadSections from "@/components/storage-locations/storage-location-read-sections";
import type { StorageLocationWithFacility } from "@/data-access/storage-locations";
import type { StorageLocationFormData } from "@/schemas/storage-locations";
import { StorageLocationQuickAddDialog } from "./storage-location-quick-add-dialog";
function StorageBinEditDialog({ bin, close }: { bin: StorageLocationWithFacility; close: () => void }) {
  return <StorageLocationQuickAddDialog isOpen storageLocation={bin} facilityId={bin.facilityId} onClose={close} onSuccess={() => undefined} />;
}

const mocks = vi.hoisted(() => ({ update: vi.fn(), create: vi.fn(), success: vi.fn(), actions: undefined as unknown }));
vi.mock("@/hooks/use-storage-locations", () => ({ useUpdateStorageLocation: () => ({ mutateAsync: mocks.update, isPending: false }) }));
vi.mock("@/hooks/use-record-locks", async () => (await import("../../../../tests/helpers/record-lock-mocks")).openRecordLocksModule);
vi.mock("@/hooks/use-quick-add-submit", () => ({ useQuickAddSubmit: () => ({ handleSubmit: mocks.create, isSubmitting: false, error: null }) }));
vi.mock("@/fn/quick-add", () => ({ createStorageLocationFn: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: mocks.success }) }));
vi.mock("@/components/storage-locations/storage-location-form", () => ({
  StorageLocationForm: ({ onSubmit, onCancel, errorMessage, submitLabel }: { onCancel: () => void; onSubmit: (data: StorageLocationFormData) => void; errorMessage?: string; submitLabel: string }) => {
    mocks.actions = useSideSheetActions();
    const { control, register } = useForm({ defaultValues: { name: "North bin" } });
    return <form aria-label="Bin form" onSubmit={(event) => { event.preventDefault(); onSubmit({ name: "Renamed bin", facilityId: "facility", type: "feedstock_bin" } as StorageLocationFormData); }}>
      <input aria-label="Bin name" {...register("name")} />
      <FormActions control={control} onCancel={onCancel} errorMessage={errorMessage} submitLabel={submitLabel} sticky={false} guardDialogCancel />
    </form>;
  },
}));
const bin = {
  id: "one", name: "North bin", facilityId: "facility", version: 7, type: "feedstock_bin", archivedAt: null,
  feedstockInventory: { currentWetMassKg: 0, pendingWetMassKg: 0, estimatedDryMassKg: 0, estimatedMoisturePercent: null, feedstockTypes: [] },
} as unknown as StorageLocationWithFacility;
afterEach(cleanup);
beforeEach(() => { window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }); mocks.update.mockReset().mockResolvedValue(bin); mocks.create.mockReset(); mocks.success.mockReset(); mocks.actions = undefined; });

describe("StorageLocationQuickAddDialog edit mode", () => {
  it("isolates a portalled submit from the entry form and uses the loaded version", async () => {
    const outer = vi.fn(); const close = vi.fn(); const selected = vi.fn();
    render(<form onSubmit={outer}><StorageLocationQuickAddDialog isOpen storageLocation={bin} facilityId="facility" onClose={close} onSuccess={selected} /></form>);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Renamed bin" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(outer).not.toHaveBeenCalled(); expect(selected).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Discard unsaved changes?" })).toBeNull();
    expect(mocks.update).toHaveBeenCalledWith({ name: "Renamed bin", facilityId: "facility", type: "feedstock_bin", storageLocationId: "one", expectedVersion: 7 });
    expect(mocks.success).toHaveBeenCalledWith("Storage bin updated.");
  });
  it.each(["Escape", "Close", "Cancel", "Backdrop"])("guards dirty edits on %s and preserves values when kept", async (action) => {
    const close = vi.fn();
    render(<StorageLocationQuickAddDialog isOpen storageLocation={bin} facilityId="facility" onClose={close} onSuccess={vi.fn()} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Unsaved bin" } });
    if (action === "Escape") {
      input.focus();
      fireEvent.keyDown(input, { key: "Escape" });
    } else if (action === "Backdrop") {
      const backdrop = document.querySelector('[data-overlay-layer="dialog-backdrop"]')!;
      fireEvent.mouseDown(backdrop);
      fireEvent.mouseUp(backdrop);
      fireEvent.click(backdrop);
    } else fireEvent.click(screen.getByRole("button", { name: action }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Discard unsaved changes?" })).toBeTruthy());
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Discard unsaved changes?" })).toBeNull());
    expect((input as HTMLInputElement).value).toBe("Unsaved bin");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard changes" }));
    expect(close).toHaveBeenCalledOnce();
  });

  it("guards dirty create forms too", async () => {
    const close = vi.fn();
    render(<StorageLocationQuickAddDialog isOpen facilityId="facility" onClose={close} onSuccess={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "New bin" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("dialog", { name: "Discard unsaved changes?" })).toBeTruthy();
    expect(close).not.toHaveBeenCalled();
  });

  it("hides the entry sheet actions from the nested form", () => {
    render(<SideSheetActionsContext.Provider value={{ cancel: vi.fn(), reportDirty: vi.fn() } as never}>
      <StorageBinEditDialog bin={bin} close={vi.fn()} />
    </SideSheetActionsContext.Provider>);
    expect(mocks.actions).toBeNull();
  });
  it("renders archived bins read-only without reconcile or loss actions", () => {
    render(<StorageBinEditDialog bin={{ ...bin, archivedAt: new Date() }} close={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "North bin" })).toBeTruthy();
    expect(screen.queryByRole("form")).toBeNull();
    expect(screen.queryByText("Reconcile stock")).toBeNull();
    expect(screen.queryByText("Record loss")).toBeNull();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("passes only section identifiers, labels and fields to the archived dialog", () => {
    const fields = [{ label: "Bin name", value: bin.name }];
    const sections: (detailPanel.DetailPanelSection & { actions: string })[] = [
      { id: "headingless", fields, actions: "Record loss" },
      { id: "storage", title: "Storage details", fields, actions: "Record loss" },
      { title: "Inventory", fields, content: "Reconcile stock", hint: "Stock hint", explanation: "Stock calculation", actions: "Record loss" },
    ];
    vi.spyOn(storageLocationReadSections, "storageLocationSheetSections").mockReturnValueOnce(sections);
    const spine = vi.spyOn(detailPanel, "DetailSpine");
    render(<StorageBinEditDialog bin={{ ...bin, archivedAt: new Date() }} close={vi.fn()} />);
    expect(spine.mock.lastCall?.[0].sections).toStrictEqual([
      { id: "headingless", title: undefined, fields },
      { id: "storage", title: "Storage details", fields },
      { title: "Inventory", fields },
    ]);
  });
  it("keeps the form open on a save failure", async () => {
    mocks.update.mockRejectedValue(new Error("Save refused")); const close = vi.fn();
    render(<StorageBinEditDialog bin={bin} close={close} />);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Save refused"));
    expect(close).not.toHaveBeenCalled();
  });
  it("keeps create mode and its submit isolation", () => {
    const outer = vi.fn();
    render(<form onSubmit={outer}><StorageLocationQuickAddDialog isOpen facilityId="facility" onClose={vi.fn()} onSuccess={vi.fn()} /></form>);
    fireEvent.click(screen.getByRole("button", { name: "Create storage bin" }));
    expect(mocks.create).toHaveBeenCalledOnce(); expect(outer).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
  });
});
