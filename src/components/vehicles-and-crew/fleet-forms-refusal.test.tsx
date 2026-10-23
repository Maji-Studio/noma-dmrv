// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DriverForm } from "@/components/drivers/driver-form";
import { OperatorForm } from "@/components/operators/operator-form";
import { VehicleForm } from "@/components/vehicles/vehicle-form";
import type { Driver, Operator, Vehicle } from "@/db/schema";
import { ActionError } from "@/lib/action-error";
import { fieldRefusal, RefusalParent } from "../../../tests/helpers/refusal-form-parent";
import { FleetSheetForm } from "./fleet-sheet-forms";

const mocks = vi.hoisted(() => ({ updateDriver: vi.fn(), createDriver: vi.fn(), updateVehicle: vi.fn() }));
vi.mock("@/fn/quick-add", () => ({ createDriverFn: mocks.createDriver, createOperatorFn: vi.fn(), createVehicleFn: vi.fn() }));
vi.mock("@/hooks/use-fleet", () => ({
  useInvalidateFleetKind: () => vi.fn(),
  useUpdateVehicle: () => ({ mutateAsync: mocks.updateVehicle, isPending: false }),
  useUpdateDriver: () => ({ mutateAsync: mocks.updateDriver, isPending: false }),
  useUpdateOperator: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const driver = { id: "d1", name: "Asha", licenseNumber: "", contactPhone: "", version: 2 } as unknown as Driver;
const operator = { id: "o1", name: "Juma", credentials: "", contactPhone: "" } as unknown as Operator;
const vehicle = {
  id: "v1", name: "Truck 01", identifier: "", vehicleType: "Heavy truck", fuelType: "Diesel", fuelConsumptionLPerKm: "0.3", modelYear: 2020, version: 3,
} as unknown as Vehicle;

afterEach(cleanup);

describe("fleet forms refused save", () => {
  // Form contract cases: the server validates `name` with the form's own Zod schema, so a Zod issue at
  // ["name"] is a real shape; duplicate-name conflicts carry no path (see the vehicle case below).
  it("shows a driver name refusal at the name field with no footer", async () => {
    render(<RefusalParent refusal={fieldRefusal(["name"], "Driver name must be less than 255 characters")} fallback="not saved">{(props) => <DriverForm driver={driver} {...props} />}</RefusalParent>);
    fireEvent.submit(screen.getByRole("textbox", { name: /^Name/ }).closest("form")!);
    await waitFor(() => expect(document.querySelector("#name-error")?.textContent).toContain("Driver name must be less than 255 characters"));
    expect(screen.getByTestId("footer").textContent).toBe("none");
  });

  it("shows an operator phone refusal at the phone field with no footer", async () => {
    render(<RefusalParent refusal={fieldRefusal(["contactPhone"], "Enter a phone number")} fallback="not saved">{(props) => <OperatorForm operator={operator} {...props} />}</RefusalParent>);
    fireEvent.submit(screen.getByRole("textbox", { name: /^Name/ }).closest("form")!);
    await waitFor(() => expect(document.querySelector("#contactPhone-error")?.textContent).toContain("Enter a phone number"));
    expect(screen.getByTestId("footer").textContent).toBe("none");
  });

  // Real server shape: the vehicle payload names fuel consumption in L/km, the form asks for L/100 km.
  it("shows a fuel consumption refusal at the L/100 km field", async () => {
    render(<RefusalParent refusal={fieldRefusal(["fuelConsumptionLPerKm"], "Fuel consumption seems too high")} fallback="not saved">{(props) => <VehicleForm vehicle={vehicle} {...props} />}</RefusalParent>);
    fireEvent.submit(screen.getByRole("textbox", { name: /^Name/ }).closest("form")!);
    await waitFor(() => expect(document.querySelector("#fuelConsumptionLPer100Km-error")?.textContent).toContain("too high"));
    expect(screen.getByTestId("footer").textContent).toBe("none");
  });
});

describe("fleet sheet parents", () => {
  const renderSheet = (record: Driver | null) => render(
    <QueryClientProvider client={new QueryClient()}>
      <FleetSheetForm kind="driver" record={record} onSaved={vi.fn()} onCancel={vi.fn()} />
    </QueryClientProvider>,
  );

  it("shows a refused driver edit at its field and leaves no footer", async () => {
    mocks.updateDriver.mockRejectedValueOnce(fieldRefusal(["name"], "Driver name must be less than 255 characters"));
    renderSheet(driver);
    fireEvent.submit(screen.getByRole("textbox", { name: /^Name/ }).closest("form")!);
    await waitFor(() => expect(document.querySelector("#name-error")?.textContent).toContain("Driver name must be less than 255 characters"));
    expect(screen.getAllByRole("alert").filter((node) => node.id !== "name-error" && node.textContent?.includes("Driver name must be less than 255 characters"))).toEqual([]);
  });

  it("shows a refused driver create at its field and leaves no footer", async () => {
    mocks.createDriver.mockResolvedValueOnce({
      success: false, error: "Driver name must be less than 255 characters", code: "validation_failed",
      issues: [{ path: ["name"], code: "validation_failed", message: "Driver name must be less than 255 characters" }],
    });
    renderSheet(null);
    fireEvent.change(screen.getByRole("textbox", { name: /^Name/ }), { target: { value: "Asha" } });
    fireEvent.submit(screen.getByRole("textbox", { name: /^Name/ }).closest("form")!);
    await waitFor(() => expect(document.querySelector("#name-error")?.textContent).toContain("Driver name must be less than 255 characters"));
    expect(screen.getAllByRole("alert").filter((node) => node.id !== "name-error" && node.textContent?.includes("Driver name must be less than 255 characters"))).toEqual([]);
  });

  // Real server shape: DomainError("conflict", VEHICLE_NAME_TAKEN), no issues, so the sheet shows the message.
  it("shows a vehicle name conflict in the sheet's message line, not at a field", async () => {
    mocks.updateVehicle.mockRejectedValueOnce(new ActionError({ error: "A vehicle with this name already exists", code: "conflict" }));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <FleetSheetForm kind="vehicle" record={vehicle} onSaved={vi.fn()} onCancel={vi.fn()} />
      </QueryClientProvider>,
    );
    fireEvent.submit(screen.getByRole("textbox", { name: /^Name/ }).closest("form")!);
    await waitFor(() => expect(screen.getAllByRole("alert").some((node) => node.textContent?.includes("A vehicle with this name already exists"))).toBe(true));
    expect(document.querySelector("#name-error")).toBeNull();
  });

  it("keeps the old message line for a refusal that names no field", async () => {
    mocks.updateDriver.mockRejectedValueOnce(new Error("Offline"));
    renderSheet(driver);
    fireEvent.submit(screen.getByRole("textbox", { name: /^Name/ }).closest("form")!);
    await waitFor(() => expect(screen.getAllByRole("alert").some((node) => node.textContent?.includes("Offline"))).toBe(true));
  });
});
