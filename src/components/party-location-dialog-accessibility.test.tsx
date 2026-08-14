import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SupplierLocation } from "@/db/schema/parties";
import { CustomerLocationDialog } from "./customers/customer-location-dialog";
import type { EditableCustomerLocation } from "./customers/customer-location-form";
import { SupplierLocationDialog } from "./suppliers/supplier-location-dialog";

const CUSTOMER_ID = "6f1c4d3a-0f2b-4d6a-9f1e-0a1b2c3d4e5f";
const SUPPLIER_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const CUSTOMER_LOCATION_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const SUPPLIER_LOCATION_ID = "11111111-2222-4333-8444-555555555555";

vi.mock("@/components/forms/entity-select/quick-add-dialog-shell", () => ({
  QuickAddDialogShell: ({
    children,
    isOpen,
  }: {
    children: ReactNode;
    isOpen: boolean;
  }) => (isOpen ? <div role="dialog">{children}</div> : null),
}));

vi.mock("@/components/forms/position-picker", () => ({
  PositionPicker: ({
    idPrefix,
    label,
  }: {
    idPrefix: string;
    label: string;
  }) => (
    <label htmlFor={`${idPrefix}-latitude`}>
      {label}
      <input id={`${idPrefix}-latitude`} />
    </label>
  ),
}));

vi.mock("@/components/forms/distance-calc-field", () => ({
  DistanceCalcField: ({ id, label }: { id: string; label: string }) => (
    <label htmlFor={id}>
      {label}
      <input id={id} />
    </label>
  ),
}));

vi.mock("@/hooks/use-customers", () => ({
  useCreateCustomerLocation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateCustomerLocation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/use-suppliers", () => ({
  useCreateSupplierLocation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateSupplierLocation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/use-organization-settings", () => ({
  useOrganizationDefaultValues: () => ({
    defaults: { defaultCountry: "Tanzania" },
  }),
}));

vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({ selectedFacility: null }),
}));

const customerLocation: EditableCustomerLocation = {
  id: CUSTOMER_LOCATION_ID,
  name: "Application site",
  country: "Tanzania",
  stateRegion: null,
  city: null,
  address: "Field A",
  gpsLatitude: -6.8,
  gpsLongitude: 39.28,
  distanceFromFacilityKm: 12.5,
  distanceSource: "manual",
  defaultSoilTemperatureC: 25,
  isDefault: true,
};

const supplierLocation: SupplierLocation = {
  id: SUPPLIER_LOCATION_ID,
  organizationId: "org-1",
  supplierId: SUPPLIER_ID,
  name: "Collection yard",
  country: "Tanzania",
  stateRegion: null,
  city: null,
  address: null,
  gpsLatitude: -6.8,
  gpsLongitude: 39.28,
  distanceFromFacilityKm: 12.5,
  distanceSource: "manual",
  isDefault: true,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

function expectUniqueIdsAndAssociatedLabels(markup: string, prefix: string) {
  const ids = [...markup.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const labelTargets = [...markup.matchAll(/\sfor="([^"]+)"/g)].map(
    (match) => match[1],
  );

  expect(ids.some((id) => id.startsWith(prefix))).toBe(true);
  expect(new Set(ids).size).toBe(ids.length);
  expect(labelTargets.length).toBeGreaterThan(0);
  for (const target of labelTargets) expect(ids).toContain(target);
}

describe("party location edit dialog field IDs", () => {
  it("keeps customer dialog IDs unique from the underlying edit form", () => {
    const markup = renderToStaticMarkup(
      <>
        <label htmlFor="name">Customer name</label>
        <input id="name" />
        <CustomerLocationDialog
          isOpen
          onClose={vi.fn()}
          customerId={CUSTOMER_ID}
          location={customerLocation}
        />
      </>,
    );

    expectUniqueIdsAndAssociatedLabels(markup, "customer-location-dialog-");
  });

  it("keeps supplier dialog IDs unique from the underlying edit form", () => {
    const markup = renderToStaticMarkup(
      <>
        <label htmlFor="name">Supplier name</label>
        <input id="name" />
        <SupplierLocationDialog
          isOpen
          onClose={vi.fn()}
          supplierId={SUPPLIER_ID}
          location={supplierLocation}
        />
      </>,
    );

    expectUniqueIdsAndAssociatedLabels(markup, "supplier-location-dialog-");
  });
});
