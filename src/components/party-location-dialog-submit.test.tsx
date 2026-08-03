/**
 * Behavioral coverage for the party location edit path shipped alongside the
 * detail-page Edit buttons. The grep-shaped assertions in
 * `location-management-actions.test.ts` prove the buttons are wired up; these
 * exercise the dialogs' real `handleSubmit` and pin the exact payload handed to
 * the mutation, so a dropped `locationId` or a lost coordinate fails here
 * rather than in production.
 *
 * The embedded form is mocked to capture its `onSubmit`, which lets the suite
 * stay a `react-dom/server` render in the repo's node test environment (there
 * is no DOM testing library here).
 */
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupplierLocation } from "@/db/schema/parties";
import { customerLocationFormSchema } from "@/schemas/customers";
import { supplierLocationFormSchema } from "@/schemas/suppliers";
import { CustomerLocationDialog } from "./customers/customer-location-dialog";
import type { EditableCustomerLocation } from "./customers/customer-location-form";
import { SupplierLocationDialog } from "./suppliers/supplier-location-dialog";

const CUSTOMER_ID = "6f1c4d3a-0f2b-4d6a-9f1e-0a1b2c3d4e5f";
const SUPPLIER_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const CUSTOMER_LOCATION_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const SUPPLIER_LOCATION_ID = "11111111-2222-4333-8444-555555555555";
const GPS_LATITUDE = -6.8;
const GPS_LONGITUDE = 39.28;
const DISTANCE_KM = 12.5;

type SubmitHandler = (data: never) => Promise<void> | void;

const harness = vi.hoisted(() => ({
  customerCreate: vi.fn(),
  customerUpdate: vi.fn(),
  supplierCreate: vi.fn(),
  supplierUpdate: vi.fn(),
  customerOnSubmit: null as SubmitHandler | null,
  supplierOnSubmit: null as SubmitHandler | null,
  customerSubmitLabel: "",
  supplierSubmitLabel: "",
  titles: [] as string[],
}));

vi.mock("@/components/forms/entity-select/quick-add-dialog-shell", () => ({
  QuickAddDialogShell: ({
    title,
    children,
  }: {
    title: string;
    children: ReactNode;
  }) => {
    harness.titles.push(title);
    return <div data-title={title}>{children}</div>;
  },
}));

vi.mock("@/hooks/use-customers", () => ({
  useCreateCustomerLocation: () => ({
    mutateAsync: harness.customerCreate,
    isPending: false,
  }),
  useUpdateCustomerLocation: () => ({
    mutateAsync: harness.customerUpdate,
    isPending: false,
  }),
}));

vi.mock("@/hooks/use-suppliers", () => ({
  useCreateSupplierLocation: () => ({
    mutateAsync: harness.supplierCreate,
    isPending: false,
  }),
  useUpdateSupplierLocation: () => ({
    mutateAsync: harness.supplierUpdate,
    isPending: false,
  }),
}));

vi.mock("./customers/customer-location-form", () => ({
  CustomerLocationForm: (props: {
    onSubmit: SubmitHandler;
    submitLabel?: string;
  }) => {
    harness.customerOnSubmit = props.onSubmit;
    harness.customerSubmitLabel = props.submitLabel ?? "";
    return null;
  },
}));

vi.mock("./suppliers/supplier-location-form", () => ({
  SupplierLocationForm: (props: {
    onSubmit: SubmitHandler;
    submitLabel?: string;
  }) => {
    harness.supplierOnSubmit = props.onSubmit;
    harness.supplierSubmitLabel = props.submitLabel ?? "";
    return null;
  },
}));

/** Parsed through the real schema so the payload matches what RHF hands over. */
const customerFormData = customerLocationFormSchema.parse({
  name: "Updated field",
  country: "Tanzania",
  stateRegion: "",
  city: "",
  address: "E2E application site",
  gpsLatitude: GPS_LATITUDE,
  gpsLongitude: GPS_LONGITUDE,
  distanceFromFacilityKm: DISTANCE_KM,
  distanceSource: "manual",
  defaultSoilTemperatureC: 25,
  isDefault: true,
});

const supplierFormData = supplierLocationFormSchema.parse({
  name: "Updated yard",
  country: "Tanzania",
  stateRegion: "",
  city: "",
  address: "",
  gpsLatitude: GPS_LATITUDE,
  gpsLongitude: GPS_LONGITUDE,
  distanceFromFacilityKm: DISTANCE_KM,
  distanceSource: "manual",
  isDefault: true,
});

const customerLocation: EditableCustomerLocation = {
  id: CUSTOMER_LOCATION_ID,
  name: "Original field",
  country: "Tanzania",
  stateRegion: null,
  city: null,
  gpsLatitude: GPS_LATITUDE,
  gpsLongitude: GPS_LONGITUDE,
  address: "E2E application site",
  distanceFromFacilityKm: DISTANCE_KM,
  distanceSource: "manual",
  defaultSoilTemperatureC: 25,
  isDefault: true,
};

const supplierLocation: SupplierLocation = {
  id: SUPPLIER_LOCATION_ID,
  organizationId: "org-1",
  supplierId: SUPPLIER_ID,
  name: "Original yard",
  country: "Tanzania",
  stateRegion: null,
  city: null,
  gpsLatitude: GPS_LATITUDE,
  gpsLongitude: GPS_LONGITUDE,
  address: null,
  distanceFromFacilityKm: DISTANCE_KM,
  distanceSource: "manual",
  isDefault: true,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

beforeEach(() => {
  harness.customerCreate.mockReset();
  harness.customerUpdate.mockReset();
  harness.supplierCreate.mockReset();
  harness.supplierUpdate.mockReset();
  harness.customerOnSubmit = null;
  harness.supplierOnSubmit = null;
  harness.customerSubmitLabel = "";
  harness.supplierSubmitLabel = "";
  harness.titles.length = 0;
});

describe("CustomerLocationDialog submission", () => {
  it("updates the selected location and preserves its coordinates", async () => {
    renderToStaticMarkup(
      <CustomerLocationDialog
        isOpen
        onClose={vi.fn()}
        customerId={CUSTOMER_ID}
        location={customerLocation}
      />,
    );

    expect(harness.titles).toContain("Edit Location");
    expect(harness.customerSubmitLabel).toBe("Save Changes");

    await harness.customerOnSubmit?.(customerFormData as never);

    expect(harness.customerCreate).not.toHaveBeenCalled();
    expect(harness.customerUpdate).toHaveBeenCalledTimes(1);
    expect(harness.customerUpdate).toHaveBeenCalledWith({
      locationId: CUSTOMER_LOCATION_ID,
      name: "Updated field",
      country: "Tanzania",
      stateRegion: null,
      city: null,
      address: "E2E application site",
      gpsLatitude: GPS_LATITUDE,
      gpsLongitude: GPS_LONGITUDE,
      distanceFromFacilityKm: DISTANCE_KM,
      distanceSource: "manual",
      defaultSoilTemperatureC: 25,
      isDefault: true,
    });
  });

  it("creates against the customer when no location is selected", async () => {
    renderToStaticMarkup(
      <CustomerLocationDialog
        isOpen
        onClose={vi.fn()}
        customerId={CUSTOMER_ID}
      />,
    );

    expect(harness.titles).toContain("Add Location");
    expect(harness.customerSubmitLabel).toBe("Add Location");

    await harness.customerOnSubmit?.(customerFormData as never);

    expect(harness.customerUpdate).not.toHaveBeenCalled();
    expect(harness.customerCreate).toHaveBeenCalledTimes(1);
    expect(harness.customerCreate.mock.calls[0]?.[0]).toMatchObject({
      customerId: CUSTOMER_ID,
      gpsLatitude: GPS_LATITUDE,
      gpsLongitude: GPS_LONGITUDE,
      distanceSource: "manual",
    });
    expect(harness.customerCreate.mock.calls[0]?.[0]).not.toHaveProperty(
      "locationId",
    );
  });
});

describe("SupplierLocationDialog submission", () => {
  it("updates the selected location and preserves its coordinates", async () => {
    renderToStaticMarkup(
      <SupplierLocationDialog
        isOpen
        onClose={vi.fn()}
        supplierId={SUPPLIER_ID}
        location={supplierLocation}
      />,
    );

    expect(harness.titles).toContain("Edit Location");
    expect(harness.supplierSubmitLabel).toBe("Save Changes");

    await harness.supplierOnSubmit?.(supplierFormData as never);

    expect(harness.supplierCreate).not.toHaveBeenCalled();
    expect(harness.supplierUpdate).toHaveBeenCalledTimes(1);
    expect(harness.supplierUpdate).toHaveBeenCalledWith({
      locationId: SUPPLIER_LOCATION_ID,
      ...supplierFormData,
    });
    expect(harness.supplierUpdate.mock.calls[0]?.[0]).toMatchObject({
      gpsLatitude: GPS_LATITUDE,
      gpsLongitude: GPS_LONGITUDE,
      distanceSource: "manual",
    });
  });

  it("creates against the supplier when no location is selected", async () => {
    renderToStaticMarkup(
      <SupplierLocationDialog
        isOpen
        onClose={vi.fn()}
        supplierId={SUPPLIER_ID}
      />,
    );

    expect(harness.titles).toContain("Add Location");
    expect(harness.supplierSubmitLabel).toBe("Add Location");

    await harness.supplierOnSubmit?.(supplierFormData as never);

    expect(harness.supplierUpdate).not.toHaveBeenCalled();
    expect(harness.supplierCreate).toHaveBeenCalledTimes(1);
    expect(harness.supplierCreate.mock.calls[0]?.[0]).toMatchObject({
      supplierId: SUPPLIER_ID,
      gpsLatitude: GPS_LATITUDE,
      gpsLongitude: GPS_LONGITUDE,
      distanceSource: "manual",
    });
    expect(harness.supplierCreate.mock.calls[0]?.[0]).not.toHaveProperty(
      "locationId",
    );
  });
});
