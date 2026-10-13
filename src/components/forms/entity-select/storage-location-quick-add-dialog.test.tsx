// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SideSheetActionsContext, useSideSheetActions } from "@/components/ui/entity-side-sheet/side-sheet-context";
import type { StorageLocationWithFacility } from "@/data-access/storage-locations";
import type { StorageLocationFormData } from "@/schemas/storage-locations";
import { StorageLocationQuickAddDialog } from "./storage-location-quick-add-dialog";
import { StorageBinEditDialog } from "./storage-bin-edit-dialog";

const mocks = vi.hoisted(() => ({ update: vi.fn(), create: vi.fn(), success: vi.fn(), actions: undefined as unknown }));
vi.mock("@/hooks/use-storage-locations", () => ({ useUpdateStorageLocation: () => ({ mutateAsync: mocks.update, isPending: false }) }));
vi.mock("@/hooks/use-quick-add-submit", () => ({ useQuickAddSubmit: () => ({ handleSubmit: mocks.create, isSubmitting: false, error: null }) }));
vi.mock("@/fn/quick-add", () => ({ createStorageLocationFn: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: mocks.success }) }));
vi.mock("./quick-add-dialog-shell", () => ({
  QuickAddDialogShell: ({ isOpen, title, children }: { isOpen: boolean; title: string; children: ReactNode }) => isOpen ? createPortal(<div role="dialog" aria-label={title}>{children}</div>, document.body) : null,
}));
vi.mock("@/components/storage-locations/storage-location-form", () => ({
  StorageLocationForm: ({ onSubmit, errorMessage, submitLabel }: { onSubmit: (data: StorageLocationFormData) => void; errorMessage?: string; submitLabel: string }) => {
    mocks.actions = useSideSheetActions();
    return <form aria-label="Bin form" onSubmit={(event) => { event.preventDefault(); onSubmit({ name: "Renamed bin", facilityId: "facility", type: "feedstock_bin" } as StorageLocationFormData); }}>
      {errorMessage && <p role="alert">{errorMessage}</p>}<button type="submit">{submitLabel}</button>
    </form>;
  },
}));
const bin = {
  id: "one", name: "North bin", facilityId: "facility", version: 7, type: "feedstock_bin", archivedAt: null,
  feedstockInventory: { currentWetMassKg: 0, pendingWetMassKg: 0, estimatedDryMassKg: 0, estimatedMoisturePercent: null, feedstockTypes: [] },
} as unknown as StorageLocationWithFacility;
afterEach(cleanup);
beforeEach(() => { mocks.update.mockReset().mockResolvedValue(bin); mocks.create.mockReset(); mocks.success.mockReset(); mocks.actions = undefined; });

describe("StorageLocationQuickAddDialog edit mode", () => {
  it("isolates a portalled submit from the entry form and uses the loaded version", async () => {
    const outer = vi.fn(); const close = vi.fn(); const selected = vi.fn();
    render(<form onSubmit={outer}><StorageLocationQuickAddDialog isOpen storageLocation={bin} facilityId="facility" onClose={close} onSuccess={selected} /></form>);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(outer).not.toHaveBeenCalled(); expect(selected).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith({ name: "Renamed bin", facilityId: "facility", type: "feedstock_bin", storageLocationId: "one", expectedVersion: 7 });
    expect(mocks.success).toHaveBeenCalledWith("Storage bin updated.");
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
