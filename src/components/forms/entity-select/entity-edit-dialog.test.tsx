// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EntityEditDialog } from "./entity-edit-dialog";
import type { EditableEntityType } from "@/hooks/use-entity-edit-record";

const mocks = vi.hoisted(() => ({
  query: { data: undefined as unknown, isFetchedAfterMount: false, isFetching: true, isSuccess: false, isError: false, refetch: vi.fn() },
  load: vi.fn(), update: vi.fn(), toast: vi.fn(), restore: vi.fn(), restoreSupplier: vi.fn(), restoreCustomer: vi.fn(), success: vi.fn(),
}));
vi.mock("@/hooks/use-entity-edit-record", () => ({ useEntityEditRecord: (...args: unknown[]) => { mocks.load(...args); return mocks.query; } }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ error: mocks.toast, success: mocks.success }) }));
vi.mock("@/components/ui", () => ({ Modal: ({ children, isOpen }: { children: ReactNode; isOpen: boolean }) => isOpen ? createPortal(<div role="dialog">{children}</div>, document.body) : null }));
vi.mock("@/hooks/use-customers", () => ({
  useUpdateCustomer: () => ({ mutateAsync: mocks.update, isPending: false }),
  useRestoreCustomer: () => ({ mutateAsync: mocks.restoreCustomer, isPending: false }),
}));
vi.mock("@/hooks/use-reactors", () => ({ useUpdateReactor: () => ({ mutateAsync: mocks.update, isPending: false }) }));
vi.mock("@/hooks/use-orders", () => ({ useUpdateOrder: () => ({ mutateAsync: mocks.update, isPending: false }) }));
vi.mock("@/hooks/use-suppliers", () => ({
  useUpdateSupplier: () => ({ mutateAsync: mocks.update, isPending: false }),
  useRestoreSupplier: () => ({ mutateAsync: mocks.restoreSupplier, isPending: false }),
}));
vi.mock("@/hooks/use-formulations", () => ({
  useUpdateFormulation: () => ({ mutateAsync: mocks.update, isPending: false }),
  useRestoreFormulation: () => ({ mutateAsync: mocks.restore, isPending: false }),
}));
vi.mock("@/hooks/use-feedstock-types", () => ({ useUpdateFeedstockType: () => ({ mutateAsync: mocks.update, isPending: false }) }));

interface FormProps {
  onSubmit: (data: { name: string }) => void;
  errorMessage?: string;
  customer?: { name: string }; reactor?: { name: string }; order?: { name: string };
  supplier?: { name: string }; formulation?: { name: string }; feedstockType?: { name: string };
}
function EditForm(props: FormProps) {
  const record = props.customer ?? props.reactor ?? props.order ?? props.supplier ?? props.formulation ?? props.feedstockType;
  return <form aria-label="Edit form" onSubmit={(event) => { event.preventDefault(); props.onSubmit({ name: "Renamed" }); }}>
    <span>{record?.name}</span>{props.errorMessage && <p role="alert">{props.errorMessage}</p>}<button type="submit">Save changes</button>
  </form>;
}
vi.mock("@/components/customers/customer-form", () => ({ CustomerForm: EditForm }));
vi.mock("@/components/reactors/reactor-form", () => ({ ReactorForm: EditForm }));
vi.mock("@/components/orders/order-form", () => ({ OrderForm: EditForm }));
vi.mock("@/components/suppliers/supplier-form", () => ({ SupplierForm: EditForm }));
vi.mock("@/components/formulations/formulation-form", () => ({ FormulationForm: EditForm }));
vi.mock("@/components/feedstock-types/feedstock-type-form", () => ({ FeedstockTypeForm: EditForm }));
// These quick-add dialogs only create records; editing uses the forms directly.
vi.mock("./formulation-quick-add-dialog", () => ({ FormulationQuickAddDialog: () => { throw new Error("Quick-add cannot edit a formulation"); } }));
vi.mock("./supplier-quick-add-dialog", () => ({ SupplierQuickAddDialog: () => { throw new Error("Quick-add cannot edit a supplier"); } }));
vi.mock("./feedstock-type-quick-add-dialog", () => ({ FeedstockTypeQuickAddDialog: () => { throw new Error("Quick-add cannot edit a feedstock type"); } }));
// Their actual update and archived-bin contracts have dedicated regression suites.
vi.mock("./vehicle-quick-add-dialog", () => ({ VehicleQuickAddDialog: ({ vehicle }: { vehicle: { name: string } }) => <span>Edit vehicle {vehicle.name}</span> }));
vi.mock("./driver-quick-add-dialog", () => ({ DriverQuickAddDialog: ({ driver }: { driver: { name: string } }) => <span>Edit driver {driver.name}</span> }));
vi.mock("./operator-quick-add-dialog", () => ({ OperatorQuickAddDialog: ({ operator }: { operator: { name: string } }) => <span>Edit operator {operator.name}</span> }));
vi.mock("./storage-location-quick-add-dialog", () => ({ StorageLocationQuickAddDialog: ({ storageLocation }: { storageLocation: { name: string } }) => <span>Edit storageLocation {storageLocation.name}</span> }));

const record = { id: "one", version: 7, name: "Fresh record", facilityId: "facility" };
const editableForms = ["customer", "reactor", "order", "supplier", "formulation", "feedstockType"] as const;
const types: EditableEntityType[] = [...editableForms, "vehicle", "driver", "operator", "storageLocation"];
const dialog = (entityType: EditableEntityType, isOpen = true, onClose = vi.fn()) => <EntityEditDialog entityType={entityType} entityId="one" isOpen={isOpen} onClose={onClose} />;
function loaded() { Object.assign(mocks.query, { data: record, isFetchedAfterMount: true, isFetching: false, isSuccess: true }); }
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks(); mocks.update.mockResolvedValue(record);
  Object.assign(mocks.query, { data: undefined, isFetchedAfterMount: false, isFetching: true, isSuccess: false, isError: false });
});

describe("EntityEditDialog", () => {
  it.each(["feedstockType", "reactor", "order"] as const)("opens archived %s read-only without a save action", (type) => {
    loaded();
    mocks.query.data = { ...record, code: "ARCH-1", identifier: "Reactor 1", archivedAt: new Date() };
    render(dialog(type));
    expect(screen.getByRole("status").textContent).toContain("is archived and read-only");
    expect(screen.getByText("ARCH-1")).toBeTruthy();
    expect(screen.getByText("Fresh record")).toBeTruthy();
    expect(screen.getByText("Reactor 1")).toBeTruthy();
    expect(screen.queryByRole("form")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("opens an archived formulation read-only with the archived notice and Restore", async () => {
    loaded();
    mocks.query.data = { ...record, code: "BCF-0003", archivedAt: new Date() };
    mocks.restore.mockResolvedValue(record);
    const close = vi.fn();
    render(dialog("formulation", true, close));
    expect(screen.getByRole("status").textContent).toContain("This formulation is archived. Pickers hide it and new products, orders and bins cannot use it.");
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(mocks.restore).toHaveBeenCalledWith({ formulationId: "one", expectedVersion: 7 });
    expect(mocks.success).toHaveBeenCalledWith("Formulation BCF-0003 restored.");
  });
  it.each([
    ["supplier", "SUP-0007", "supplierId", "restoreSupplier", "This supplier is archived. Pickers hide it and new intakes cannot use it.", "Supplier SUP-0007 restored."],
    ["customer", "CUST-0007", "customerId", "restoreCustomer", "This customer is archived. Pickers hide it and new orders cannot use it. Existing orders keep it.", "Customer CUST-0007 restored."],
  ] as const)("opens an archived %s read-only with the archived notice and Restore", async (type, code, idField, restoreMock, notice, toast) => {
    loaded();
    mocks.query.data = { ...record, code, archivedAt: new Date() };
    mocks[restoreMock].mockResolvedValue(record);
    const close = vi.fn();
    render(dialog(type, true, close));
    expect(screen.getByRole("status").textContent).toContain(notice);
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(mocks[restoreMock]).toHaveBeenCalledWith({ [idField]: "one", expectedVersion: 7 });
    expect(mocks.success).toHaveBeenCalledWith(toast);
  });
  it("explains a stale Restore in the archived supplier dialog", async () => {
    loaded();
    mocks.query.data = { ...record, code: "SUP-0007", archivedAt: new Date() };
    mocks.restoreSupplier.mockRejectedValue(new Error("Restore refused"));
    const close = vi.fn();
    render(dialog("supplier", true, close));
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(await screen.findByText("Restore refused")).toBeTruthy();
    expect(close).not.toHaveBeenCalled();
  });
  it("shows a refused Restore inside the archived formulation dialog", async () => {
    loaded();
    mocks.query.data = { ...record, code: "BCF-0003", archivedAt: new Date() };
    mocks.restore.mockRejectedValue(new Error("Restore refused"));
    render(dialog("formulation"));
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect((await screen.findByText("Restore refused"))).toBeTruthy();
  });
  it.each(types)("loads %s fresh before rendering its edit surface", (type) => {
    mocks.query.data = { ...record, name: "Cached" };
    const view = render(dialog(type));
    expect(screen.queryByText("Cached")).toBeNull();
    expect(mocks.load).toHaveBeenCalledWith(type, "one");
    loaded(); view.rerender(dialog(type));
    expect(screen.getByText(/Fresh record/)).toBeTruthy();
  });
  it.each(editableForms)("saves %s with its opening version and isolates submit", async (type) => {
    loaded(); const close = vi.fn(); const outer = vi.fn();
    render(<form onSubmit={outer}>{dialog(type, true, close)}</form>);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(mocks.update).toHaveBeenCalledWith({ name: "Renamed", [`${type}Id`]: "one", expectedVersion: 7 });
    expect(outer).not.toHaveBeenCalled();
  });
  it.each(types)("toasts a failed %s load and offers retry", (type) => {
    Object.assign(mocks.query, { isError: true, isFetching: false });
    render(dialog(type));
    expect(mocks.toast).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert").textContent).toContain("could not be loaded");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.query.refetch).toHaveBeenCalledOnce();
  });
  it("keeps the opening version after a refused save and a background read", async () => {
    loaded(); mocks.update.mockRejectedValueOnce(new Error("Save refused"));
    const close = vi.fn(); const view = render(dialog("supplier", true, close));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Save refused");
    mocks.query.data = { ...record, version: 8 }; view.rerender(dialog("supplier", true, close));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(mocks.update).toHaveBeenLastCalledWith(expect.objectContaining({ expectedVersion: 7 }));
  });
  it("discards the closed session and ignores a load that finishes after close", () => {
    const view = render(dialog("storageLocation"));
    view.rerender(dialog("storageLocation", false)); loaded();
    view.rerender(dialog("storageLocation", false));
    expect(screen.queryByRole("dialog")).toBeNull();
    mocks.query.isFetchedAfterMount = false;
    view.rerender(dialog("storageLocation"));
    expect(screen.queryByText(/Fresh record/)).toBeNull();
  });
  it("does not load without a selection", () => {
    render(<EntityEditDialog entityType="supplier" entityId={null} isOpen onClose={vi.fn()} />);
    expect(mocks.load).not.toHaveBeenCalled();
  });
});
