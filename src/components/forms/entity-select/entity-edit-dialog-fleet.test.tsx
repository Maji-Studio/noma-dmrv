import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormEvent, ReactElement, ReactNode } from "react";
import type { Operator, Vehicle } from "@/db/schema";
import { StaleVersionError, STALE_VERSION_CONFLICT_CODE, STALE_VERSION_MESSAGE } from "@/lib/stale-version";

const mocks = vi.hoisted(() => ({
  record: { data: undefined as unknown, dataUpdatedAt: 0, isError: false, refetch: vi.fn() },
  updateVehicle: vi.fn(),
  updateDriver: vi.fn(),
  updateOperator: vi.fn(),
}));

vi.mock("@/components/ui/modal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui/modal")>();
  return {
    ...actual,
    Modal: ({ children, isOpen }: { children: ReactNode; isOpen: boolean }) =>
      isOpen ? <div role="dialog">{children}</div> : null,
  };
});

// Base UI's floating focus hooks need a DOM; these tests run in Node.
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  InfoHint: () => null,
}));

vi.mock("@/fn/quick-add", () => ({
  createVehicleFn: vi.fn(),
  createDriverFn: vi.fn(),
  createOperatorFn: vi.fn(),
}));

vi.mock("@/hooks/use-quick-add-submit", () => ({
  useQuickAddSubmit: () => ({ error: null, isSubmitting: false, handleSubmit: vi.fn() }),
}));

vi.mock("@/hooks/use-fleet", () => ({
  useUpdateVehicle: () => ({ mutateAsync: mocks.updateVehicle, isPending: false }),
  useUpdateDriver: () => ({ mutateAsync: mocks.updateDriver, isPending: false }),
  useUpdateOperator: () => ({ mutateAsync: mocks.updateOperator, isPending: false }),
}));

vi.mock("@/hooks/use-entity-edit-record", async () => {
  const { useState } = await import("react");
  return { useEntityEditRecord: () => {
    const [openedAt] = useState(mocks.record.dataUpdatedAt);
    return { ...mocks.record, isFetchedAfterMount: mocks.record.dataUpdatedAt > openedAt,
      isFetching: false, isSuccess: !mocks.record.isError };
  } };
});
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ error: vi.fn() }) }));

import { EntityEditDialog } from "./entity-edit-dialog";

const vehicle: Vehicle = {
  id: "8f6c2c3e-0d7a-4c1b-9a51-2f3f6d1e9b10",
  version: 3,
  organizationId: "org-1",
  code: "VEH-001",
  name: "Feedstock truck",
  identifier: "T 123 ABC",
  vehicleType: "truck",
  fuelType: "Diesel",
  fuelConsumptionLPerKm: 0.3,
  modelYear: 2019,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

const operator: Operator = {
  version: 2,
  id: "3b1f8f0e-5d1c-4a3e-8f61-7c2b9d4e0a21",
  organizationId: "org-1",
  name: "Asha",
  credentials: "Kiln lead",
  contactPhone: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

let tree: ReactTestRenderer;

function text(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === "string" ? child : text(child))).join("");
}

async function submit(outerSubmit = vi.fn()) {
  // The dialog form sits inside an entry form in the React tree.
  await act(async () => {
    const form = tree.root.findAllByType("form").find((node) => node.props.onSubmit !== outerSubmit)!;
    await form.props.onSubmit({ preventDefault() {}, stopPropagation() {} } as unknown as FormEvent);
  });
}

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

let fetchClock = 0;
let element: (isOpen: boolean) => ReactElement;

/** A read of `data` lands: React Query bumps `dataUpdatedAt` on every fetch. */
function landRead(data: unknown) {
  fetchClock += 1;
  mocks.record = { data, dataUpdatedAt: fetchClock, isError: false, refetch: vi.fn() };
}

async function rerender(isOpen: boolean) {
  await act(async () => tree.update(element(isOpen)));
}

/** Mount closed with a cached row (if any), open, then land the opening read. */
async function openOn(dialog: typeof element, cached: unknown, fresh: unknown) {
  element = dialog;
  if (cached !== undefined) landRead(cached);
  else mocks.record = { data: undefined, dataUpdatedAt: 0, isError: false, refetch: vi.fn() };
  await act(async () => { tree = create(element(false)); });
  await rerender(true);
  landRead(fresh);
  await rerender(true);
}

function vehicleDialog(onClose = vi.fn()) {
  return function renderVehicleDialog(isOpen: boolean) {
    return <EntityEditDialog entityType="vehicle" entityId={vehicle.id} isOpen={isOpen} onClose={onClose} />;
  };
}

async function typeName(value: string) {
  await act(async () => {
    const name = tree.root.findAllByType("input").find((node) => node.props.id === "name")!;
    await name.props.onChange({ target: { name: "name", value } });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchClock = 0;
  mocks.updateVehicle.mockResolvedValue({ ...vehicle, version: 4 });
  mocks.updateOperator.mockResolvedValue(operator);
});

afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
});

describe("EntityEditDialog", () => {
  it("opens the vehicle in the quick-add dialog and saves an update with the loaded version", async () => {
    const onClose = vi.fn();
    await openOn(vehicleDialog(onClose), undefined, vehicle);
    expect(text(tree.root)).toContain("Edit vehicle");

    // Submitting untouched proves every field was pre-filled from the record.
    await submit();

    expect(mocks.updateVehicle).toHaveBeenCalledWith({
      vehicleId: vehicle.id,
      expectedVersion: 3,
      name: "Feedstock truck",
      identifier: "T 123 ABC",
      vehicleType: "truck",
      fuelType: "Diesel",
      fuelConsumptionLPerKm: 0.3,
      modelYear: 2019,
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("waits for the opening read instead of editing a cached older row", async () => {
    const newer = { ...vehicle, name: "Saved elsewhere", version: 4 };
    element = vehicleDialog();
    landRead(vehicle);
    await act(async () => { tree = create(element(false)); });
    await rerender(true);
    // The cached row is on screen only as a loading state, never as the form.
    expect(tree.root.findAllByType("form")).toHaveLength(0);

    landRead(newer);
    await rerender(true);
    await submit();
    expect(mocks.updateVehicle).toHaveBeenLastCalledWith(expect.objectContaining({
      name: "Saved elsewhere",
      expectedVersion: 4,
    }));
  });

  it("selects the fuel type option for a value stored in another case", async () => {
    await openOn(vehicleDialog(), undefined, { ...vehicle, fuelType: "diesel" });
    await submit();
    expect(mocks.updateVehicle).toHaveBeenLastCalledWith(expect.objectContaining({ fuelType: "Diesel" }));
  });

  it("keeps a stored fuel type that matches no option", async () => {
    await openOn(vehicleDialog(), undefined, { ...vehicle, fuelType: "LPG" });
    await submit();
    expect(mocks.updateVehicle).toHaveBeenLastCalledWith(expect.objectContaining({ fuelType: "LPG" }));
  });

  it("does not submit the entry form it is nested in", async () => {
    const outerSubmit = vi.fn();
    await openOn((isOpen) => (
      <form onSubmit={outerSubmit}>
        <EntityEditDialog entityType="vehicle" entityId={vehicle.id} isOpen={isOpen} onClose={vi.fn()} />
      </form>
    ), undefined, vehicle);
    const wrapper = tree.root.findAll((node) => node.type === "div" && typeof node.props.onSubmit === "function")[0];
    const stopPropagation = vi.fn();
    wrapper.props.onSubmit({ stopPropagation });
    expect(stopPropagation).toHaveBeenCalledOnce();
  });

  it("keeps the dialog open and shows the refusal when the type is locked", async () => {
    const refusal = "Credit batch CB-26-001 uses this vehicle's type. Keep the type, or add a new vehicle for the new type.";
    mocks.updateVehicle.mockRejectedValueOnce(new Error(refusal));
    const onClose = vi.fn();
    await openOn(vehicleDialog(onClose), undefined, vehicle);
    await submit();

    expect(onClose).not.toHaveBeenCalled();
    expect(text(tree.root)).toContain(refusal);
  });

  it("keeps the draft and the loaded version when a stale save refetches the record", async () => {
    mocks.updateVehicle.mockRejectedValueOnce(new StaleVersionError(STALE_VERSION_MESSAGE, {
      entity: "vehicle", id: vehicle.id, code: STALE_VERSION_CONFLICT_CODE,
    }));
    await openOn(vehicleDialog(), undefined, vehicle);
    await typeName("Draft name");
    await submit();

    // The hook's invalidation refetches a newer row while the dialog is open.
    landRead({ ...vehicle, name: "Saved elsewhere", version: 4 });
    await rerender(true);

    expect(text(tree.root)).toContain(STALE_VERSION_MESSAGE);
    await submit();
    expect(mocks.updateVehicle).toHaveBeenLastCalledWith(expect.objectContaining({
      name: "Draft name",
      expectedVersion: 3,
    }));
  });

  it("loads the latest record when the dialog opens again", async () => {
    await openOn(vehicleDialog(), undefined, vehicle);
    await rerender(false);
    await rerender(true);
    expect(tree.root.findAllByType("form")).toHaveLength(0);
    landRead({ ...vehicle, name: "Saved elsewhere", version: 4 });
    await rerender(true);
    await submit();
    expect(mocks.updateVehicle).toHaveBeenLastCalledWith(expect.objectContaining({
      name: "Saved elsewhere",
      expectedVersion: 4,
    }));
  });

  it("edits an operator from the fresh read, not a cached row", async () => {
    await openOn(
      (isOpen) => <EntityEditDialog entityType="operator" entityId={operator.id} isOpen={isOpen} onClose={vi.fn()} />,
      { ...operator, credentials: "Old credentials" },
      operator,
    );
    expect(text(tree.root)).toContain("Edit operator");
    await submit();
    expect(mocks.updateOperator).toHaveBeenCalledWith({
      operatorId: operator.id,
      expectedVersion: 2,
      name: "Asha",
      credentials: "Kiln lead",
      contactPhone: null,
    });
  });

  it("edits a driver with the version loaded on open", async () => {
    const driver = { ...vehicle, licenseNumber: "License", contactPhone: null };
    const close = vi.fn();
    mocks.updateDriver.mockResolvedValue(driver);
    await openOn(
      (isOpen) => <EntityEditDialog entityType="driver" entityId={driver.id} isOpen={isOpen} onClose={close} />,
      undefined,
      driver,
    );
    await submit();
    expect(mocks.updateDriver).toHaveBeenCalledWith({
      driverId: driver.id, expectedVersion: driver.version, name: driver.name,
      licenseNumber: "License", contactPhone: null,
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("shows a retry while the record cannot be loaded", async () => {
    mocks.record = { data: undefined, dataUpdatedAt: 0, isError: true, refetch: vi.fn() };
    await act(async () => {
      tree = create(<EntityEditDialog entityType="driver" entityId="driver-1" isOpen onClose={vi.fn()} />);
    });
    expect(text(tree.root)).toContain("The driver could not be loaded. Try again.");
    expect(tree.root.findAllByType("form")).toHaveLength(0);
  });
});
