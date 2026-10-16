// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { CustomerLocationDialog } from "./customers/customer-location-dialog";
import { SupplierLocationDialog } from "./suppliers/supplier-location-dialog";
import type { Facility } from "@/db/schema";
import { CustomerLocationForm } from "./customers/customer-location-form";
import { SupplierLocationForm } from "./suppliers/supplier-location-form";
import { SupplierQuickAddDialog } from "./forms/entity-select/supplier-quick-add-dialog";
import { QuickAddDialogShell } from "./forms/entity-select/quick-add-dialog-shell";

const observed = vi.hoisted(() => ({ form: null as Pick<import("react-hook-form").UseFormReturn, "getValues" | "formState"> | null }));
vi.mock("react-hook-form", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-hook-form")>();
  return { ...actual, useForm: (...args: Parameters<typeof actual.useForm>) => {
    const form = actual.useForm(...args);
    observed.form = form;
    void form.formState.isDirty;
    return form;
  } };
});

const facilities = [
  { id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", name: "First plant", gpsLatitude: 1, gpsLongitude: 2 },
  { id: "11111111-2222-4333-8444-555555555555", name: "Second plant", gpsLatitude: 3, gpsLongitude: 4 },
] as Facility[];
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityContext: () => ({ facilities, selectedFacility: facilities[0] }) }));
vi.mock("@/hooks/use-organization-settings", () => ({ useOrganizationDefaultValues: () => ({ defaults: { defaultCountry: "Tanzania" } }) }));
vi.mock("@/hooks/use-suppliers", () => ({
  useCreateSupplierWithLocations: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateSupplierLocation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateSupplierLocation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/use-customers", () => ({
  useCreateCustomerLocation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateCustomerLocation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/use-geo", () => ({
  useGeoCapabilities: () => ({ data: { routingConfigured: false } }),
  useRouteDistance: () => ({ isPending: false, isError: false }),
  useGeocodeSearch: () => ({ data: undefined, isError: false, isFetching: false }),
  useReverseGeocode: () => ({ data: null }),
}));
afterEach(cleanup);

const saved = {
  id: "22222222-2222-4333-8444-555555555555", organizationId: "org-test", supplierId: "supplier-test",
  country: "Tanzania", name: "Site", gpsLatitude: 1, gpsLongitude: 2, defaultSoilTemperatureC: null,
  address: null, stateRegion: null, city: null, isDefault: false, version: 1,
  createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
  facilityDistances: [{ facilityId: facilities[0].id, distanceKm: 12, distanceSource: "manual" as const }],
};
const cases: { name: string; render: (onClose: () => void) => ReactNode }[] = [
  ...[false, true].flatMap(edit => [
    { name: `customer full ${edit ? "edit" : "add"}`, render: (onClose: () => void) => <QuickAddDialogShell isOpen onClose={onClose} title="Location"><CustomerLocationForm location={edit ? saved : undefined} onSubmit={vi.fn()} /></QuickAddDialogShell> },
    { name: `supplier full ${edit ? "edit" : "add"}`, render: (onClose: () => void) => <QuickAddDialogShell isOpen onClose={onClose} title="Location"><SupplierLocationForm location={edit ? saved : undefined} onSubmit={vi.fn()} /></QuickAddDialogShell> },
    ...[undefined, facilities[0]].map(facility => ({
      name: `customer ${facility ? "contextual" : "standalone"} dialog ${edit ? "edit" : "add"}`,
      render: (onClose: () => void) => <CustomerLocationDialog isOpen onClose={onClose} customerId="customer-test" facility={facility} location={edit ? saved : undefined} />,
    })),
    { name: `supplier dialog ${edit ? "edit" : "add"}`, render: (onClose: () => void) => <SupplierLocationDialog isOpen onClose={onClose} supplierId="supplier-test" location={edit ? saved : undefined} /> },
  ]),
  { name: "supplier quick-add", render: onClose => <SupplierQuickAddDialog isOpen onClose={onClose} /> },
];
for (const scenario of cases) {
  it(`${scenario.name} closes untouched and guards a distance edit`, async () => {
    const onClose = vi.fn();
    const view = render(scenario.render(onClose));
    expect(observed.form!.getValues()).toEqual(observed.form!.formState.defaultValues);
    expect(observed.form!.formState.isDirty).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByText("Discard unsaved changes?")).toBeNull();
    view.unmount();
    onClose.mockClear();
    render(scenario.render(onClose));
    fireEvent.change(screen.getAllByRole("spinbutton", { name: /Distance/ })[0], { target: { value: "42" } });
    expect(observed.form!.formState.isDirty).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.getByText("Discard unsaved changes?")).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
  });
}
it("clearing a newly typed distance restores pristine defaults without reordering facilities", () => {
  render(<QuickAddDialogShell isOpen onClose={vi.fn()} title="Location"><CustomerLocationForm onSubmit={vi.fn()} /></QuickAddDialogShell>);
  const distance = screen.getAllByRole("spinbutton", { name: /Distance/ })[0];
  fireEvent.change(distance, { target: { value: "42" } });
  expect(observed.form!.formState.isDirty).toBe(true);
  fireEvent.change(distance, { target: { value: "" } });
  expect(observed.form!.formState.isDirty).toBe(false);
  expect(observed.form!.getValues()).toEqual(observed.form!.formState.defaultValues);
});
