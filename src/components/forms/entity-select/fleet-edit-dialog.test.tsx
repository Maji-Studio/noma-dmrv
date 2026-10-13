import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormEvent, ReactNode } from "react";
import type { Operator, Vehicle } from "@/db/schema";

const mocks = vi.hoisted(() => ({
  record: { data: undefined as unknown, isError: false, refetch: vi.fn() },
  updateVehicle: vi.fn(),
  updateDriver: vi.fn(),
  updateOperator: vi.fn(),
}));

vi.mock("@/components/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui")>();
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
  useFleetRecord: () => mocks.record,
  useUpdateVehicle: () => ({ mutateAsync: mocks.updateVehicle, isPending: false }),
  useUpdateDriver: () => ({ mutateAsync: mocks.updateDriver, isPending: false }),
  useUpdateOperator: () => ({ mutateAsync: mocks.updateOperator, isPending: false }),
}));

import { FleetEditDialog, isFleetKind } from "./fleet-edit-dialog";

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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.record = { data: vehicle, isError: false, refetch: vi.fn() };
  mocks.updateVehicle.mockResolvedValue({ ...vehicle, version: 4 });
  mocks.updateOperator.mockResolvedValue(operator);
});

afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
});

describe("isFleetKind", () => {
  it("matches only vehicles, drivers and operators", () => {
    expect(["vehicle", "driver", "operator", "supplier"].map(isFleetKind)).toEqual([true, true, true, false]);
  });
});

describe("FleetEditDialog", () => {
  it("opens the vehicle in the quick-add dialog and saves an update with the loaded version", async () => {
    const onClose = vi.fn();
    await act(async () => {
      tree = create(<FleetEditDialog kind="vehicle" entityId={vehicle.id} isOpen onClose={onClose} />);
    });
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

  it("does not submit the entry form it is nested in", async () => {
    const outerSubmit = vi.fn();
    await act(async () => {
      tree = create(
        <form onSubmit={outerSubmit}>
          <FleetEditDialog kind="vehicle" entityId={vehicle.id} isOpen onClose={vi.fn()} />
        </form>,
      );
    });
    const wrapper = tree.root.findAll((node) => node.type === "div" && typeof node.props.onSubmit === "function")[0];
    const stopPropagation = vi.fn();
    wrapper.props.onSubmit({ stopPropagation });
    expect(stopPropagation).toHaveBeenCalledOnce();
  });

  it("keeps the dialog open and shows the refusal when the type is locked", async () => {
    const refusal = "Credit batch CB-26-001 uses this vehicle's type. Keep the type, or add a new vehicle for the new type.";
    mocks.updateVehicle.mockRejectedValueOnce(new Error(refusal));
    const onClose = vi.fn();
    await act(async () => {
      tree = create(<FleetEditDialog kind="vehicle" entityId={vehicle.id} isOpen onClose={onClose} />);
    });
    await submit();

    expect(onClose).not.toHaveBeenCalled();
    expect(text(tree.root)).toContain(refusal);
  });

  it("edits an operator without a row version", async () => {
    mocks.record = { data: operator, isError: false, refetch: vi.fn() };
    await act(async () => {
      tree = create(<FleetEditDialog kind="operator" entityId={operator.id} isOpen onClose={vi.fn()} />);
    });
    expect(text(tree.root)).toContain("Edit operator");
    await submit();
    expect(mocks.updateOperator).toHaveBeenCalledWith({
      operatorId: operator.id,
      name: "Asha",
      credentials: "Kiln lead",
      contactPhone: null,
    });
  });

  it("shows a retry while the record cannot be loaded", async () => {
    const refetch = vi.fn();
    mocks.record = { data: undefined, isError: true, refetch };
    await act(async () => {
      tree = create(<FleetEditDialog kind="driver" entityId="driver-1" isOpen onClose={vi.fn()} />);
    });
    expect(text(tree.root)).toContain("The driver could not be loaded. Try again.");
    expect(tree.root.findAllByType("form")).toHaveLength(0);
  });
});
