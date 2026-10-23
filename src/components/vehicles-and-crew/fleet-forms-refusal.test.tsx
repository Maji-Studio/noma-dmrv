// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DriverForm } from "@/components/drivers/driver-form";
import { OperatorForm } from "@/components/operators/operator-form";
import { VehicleForm } from "@/components/vehicles/vehicle-form";
import type { Driver, Operator, Vehicle } from "@/db/schema";
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
  it("shows a driver name refusal at the name field with no footer", async () => {
    render(<RefusalParent refusal={fieldRefusal(["name"], "Driver name is taken")} fallback="not saved">{(props) => <DriverForm driver={driver} {...props} />}</RefusalParent>);
    fireEvent.submit(screen.getByRole("textbox", { name: /^Name/ }).closest("form")!);
    await waitFor(() => expect(document.querySelector("#name-error")?.textContent).toContain("Driver name is taken"));
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

  it("keeps the footer for a vehicle name conflict that names no field", async () => {
    render(<RefusalParent refusal={new Error("A vehicle with this name already exists.")} fallback="The vehicle was not saved. Try again.">{(props) => <VehicleForm vehicle={vehicle} {...props} />}</RefusalParent>);
    fireEvent.submit(screen.getByRole("textbox", { name: /^Name/ }).closest("form")!);
    await waitFor(() => expect(screen.getByTestId("footer").textContent).toBe("The vehicle was not saved. Try again."));
  });
});

describe("fleet sheet parents", () => {
  const renderSheet = (record: Driver | null) => render(
    <QueryClientProvider client={new QueryClient()}>
      <FleetSheetForm kind="driver" record={record} onSaved={vi.fn()} onCancel={vi.fn()} />
    </QueryClientProvider>,
  );

  it("shows a refused driver edit at its field and leaves no footer", async () => {
    mocks.updateDriver.mockRejectedValueOnce(fieldRefusal(["name"], "Driver name is taken"));
    renderSheet(driver);
    fireEvent.submit(screen.getByRole("textbox", { name: /^Name/ }).closest("form")!);
    await waitFor(() => expect(document.querySelector("#name-error")?.textContent).toContain("Driver name is taken"));
    expect(screen.getAllByRole("alert").filter((node) => node.id !== "name-error" && node.textContent?.includes("Driver name is taken"))).toEqual([]);
  });

  it("shows a refused driver create at its field and leaves no footer", async () => {
    mocks.createDriver.mockResolvedValueOnce({
      success: false, error: "Driver name is taken", code: "validation_failed",
      issues: [{ path: ["name"], code: "validation_failed", message: "Driver name is taken" }],
    });
    renderSheet(null);
    fireEvent.change(screen.getByRole("textbox", { name: /^Name/ }), { target: { value: "Asha" } });
    fireEvent.submit(screen.getByRole("textbox", { name: /^Name/ }).closest("form")!);
    await waitFor(() => expect(document.querySelector("#name-error")?.textContent).toContain("Driver name is taken"));
    expect(screen.getAllByRole("alert").filter((node) => node.id !== "name-error" && node.textContent?.includes("Driver name is taken"))).toEqual([]);
  });

  it("keeps the old message line for a refusal that names no field", async () => {
    mocks.updateDriver.mockRejectedValueOnce(new Error("Offline"));
    renderSheet(driver);
    fireEvent.submit(screen.getByRole("textbox", { name: /^Name/ }).closest("form")!);
    await waitFor(() => expect(screen.getAllByRole("alert").some((node) => node.textContent?.includes("Offline"))).toBe(true));
  });
});
