// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DriverQuickAddDialog } from "./driver-quick-add-dialog";
import { VehicleQuickAddDialog } from "./vehicle-quick-add-dialog";
import { OperatorQuickAddDialog } from "./operator-quick-add-dialog";

const mocks = vi.hoisted(() => ({ createDriver: vi.fn(), createOperator: vi.fn(), createVehicle: vi.fn() }));
vi.mock("@/fn/quick-add", () => ({ createDriverFn: mocks.createDriver, createOperatorFn: mocks.createOperator, createVehicleFn: mocks.createVehicle }));
vi.mock("@/hooks/use-fleet", () => ({
  useUpdateVehicle: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateDriver: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateOperator: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
// The shell calls onOpen whenever a closed dialog opens, like Modal does.
vi.mock("./quick-add-dialog-shell", async () => {
  const { useState } = await import("react");
  return {
    stopSubmitBubbling: () => undefined,
    QuickAddDialogShell: ({ children, isOpen, onOpen }: { children: ReactNode; isOpen: boolean; onOpen?: () => void }) => {
      const [wasOpen, setWasOpen] = useState(false);
      if (isOpen !== wasOpen) {
        setWasOpen(isOpen);
        if (isOpen) onOpen?.();
      }
      return isOpen ? <div>{children}</div> : null;
    },
  };
});
vi.mock("@/components/vehicles/vehicle-form", () => ({ VehicleForm: StubForm }));
vi.mock("@/components/drivers/driver-form", () => ({ DriverForm: StubForm }));
vi.mock("@/components/operators/operator-form", () => ({ OperatorForm: StubForm }));

function StubForm({ onSubmit, errorMessage, submitLabel }: {
  onSubmit: (data: { name: string }) => Promise<void>;
  errorMessage?: string;
  submitLabel: string;
}) {
  return <form onSubmit={(event) => { event.preventDefault(); void onSubmit({ name: "Asha" }); }}>
    {errorMessage && <p role="alert">{errorMessage}</p>}
    <button type="submit">{submitLabel}</button>
  </form>;
}

afterEach(cleanup);

const cases = [
  { name: "vehicle", Dialog: VehicleQuickAddDialog, create: mocks.createVehicle, label: "Create vehicle" },
  { name: "driver", Dialog: DriverQuickAddDialog, create: mocks.createDriver, label: "Create driver" },
  { name: "operator", Dialog: OperatorQuickAddDialog, create: mocks.createOperator, label: "Create operator" },
];

describe.each(cases)("$name quick add intent key", ({ Dialog, create, label }) => {
  const saved = { success: true, data: { id: "one", code: "C-1", name: "Asha" } };
  const keys = () => create.mock.calls.map(([, options]) => options.intentKey as string);

  it("keeps the key for a retry after a failure and rotates it after a save", async () => {
    create.mockReset();
    create.mockResolvedValueOnce({ success: false, error: "Save again" }).mockResolvedValue(saved);
    const created = vi.fn();
    const client = new QueryClient();
    render(<QueryClientProvider client={client}><Dialog isOpen onClose={() => undefined} onSuccess={created} /></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: label }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: label }));
    await waitFor(() => expect(created).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: label }));
    await waitFor(() => expect(created).toHaveBeenCalledTimes(2));
    expect(keys()[0]).toEqual(expect.any(String));
    expect(keys()[1]).toBe(keys()[0]);
    expect(keys()[2]).not.toBe(keys()[0]);
    client.clear();
  });

  it("starts a new key when the dialog opens again after a failed save", async () => {
    create.mockReset();
    create.mockResolvedValue({ success: false, error: "Save again" });
    const client = new QueryClient();
    const view = (isOpen: boolean) => <QueryClientProvider client={client}><Dialog isOpen={isOpen} onClose={() => undefined} /></QueryClientProvider>;
    const { rerender } = render(view(true));
    fireEvent.click(screen.getByRole("button", { name: label }));
    await screen.findByRole("alert");
    rerender(view(false));
    rerender(view(true));
    fireEvent.click(screen.getByRole("button", { name: label }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(keys()[1]).not.toBe(keys()[0]);
    client.clear();
  });
});
