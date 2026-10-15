import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Facility } from "@/db/schema";
import type { DistanceCalcField } from "@/components/forms";
import { CustomerLocationDialog } from "./customer-location-dialog";
import type { EditableCustomerLocation } from "./customer-location-form";

const state = vi.hoisted(() => ({ distanceField: vi.fn() }));

const globalFacility = {
  id: "global-facility",
  name: "Global plant",
  gpsLatitude: -6.8,
  gpsLongitude: 39.28,
} as Facility;

const location: EditableCustomerLocation = {
  id: "location-1",
  name: "North field",
  country: "Tanzania",
  stateRegion: null,
  city: null,
  address: null,
  gpsLatitude: -3.4,
  gpsLongitude: 37.4,
  distanceFromFacilityKm: null,
  distanceSource: null,
  defaultSoilTemperatureC: null,
  isDefault: false,
  version: 1,
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};
const orderFacility = {
  id: "order-facility",
  name: "Order plant",
  gpsLatitude: -3.3,
  gpsLongitude: 37.3,
} as Facility;

vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({ selectedFacility: globalFacility }),
}));
vi.mock("@/hooks/use-organization-settings", () => ({
  useOrganizationDefaultValues: () => ({ defaults: { defaultCountry: "Tanzania" } }),
}));
vi.mock("@/hooks/use-customers", () => ({
  useCreateCustomerLocation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateCustomerLocation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/components/forms/entity-select/quick-add-dialog-shell", () => ({
  QuickAddDialogShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/forms", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/forms")>(),
  PositionPicker: () => null,
  DistanceCalcField: (props: ComponentProps<typeof DistanceCalcField>) => {
    state.distanceField(props);
    return null;
  },
}));

beforeEach(() => state.distanceField.mockClear());

function renderDialog(facility?: Facility) {
  renderToStaticMarkup(
    <CustomerLocationDialog
      isOpen
      onClose={vi.fn()}
      customerId="customer-1"
      location={location}
      facility={facility}
    />,
  );
}

describe("CustomerLocationDialog distance origin", () => {
  it("uses and names the order's facility when the global selection differs", () => {
    renderDialog(orderFacility);
    expect(state.distanceField).toHaveBeenLastCalledWith(expect.objectContaining({
      origin: { lat: orderFacility.gpsLatitude, lng: orderFacility.gpsLongitude },
      originLabel: "facility Order plant",
      destination: { lat: location.gpsLatitude, lng: location.gpsLongitude },
    }));
  });

  it("keeps the global selected facility fallback for standalone callers", () => {
    renderDialog();
    expect(state.distanceField).toHaveBeenLastCalledWith(expect.objectContaining({
      origin: { lat: globalFacility.gpsLatitude, lng: globalFacility.gpsLongitude },
      originLabel: "selected facility",
    }));
  });

  it("uses valid zero coordinates from the supplied facility", () => {
    renderDialog({ ...orderFacility, gpsLatitude: 0, gpsLongitude: 0 });
    expect(state.distanceField).toHaveBeenLastCalledWith(expect.objectContaining({
      origin: { lat: 0, lng: 0 },
      originLabel: "facility Order plant",
    }));
  });
});
