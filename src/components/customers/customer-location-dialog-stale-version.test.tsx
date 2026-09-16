/**
 * A refused stale save keeps the operator's draft (issue #768).
 *
 * The dialog owns the error banner and the close decision; the embedded form
 * owns the typed values. So "the draft survives" is provable here as three
 * facts after the mutation rejects with a `StaleVersionError`: the dialog does
 * not close, it hands the form the shared stale-version message, and it hands
 * back the same `location` prop it opened with, so the form is never remounted
 * or re-seeded over what the operator typed.
 */

import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  STALE_VERSION_CONFLICT_CODE,
  STALE_VERSION_MESSAGE,
  StaleVersionError,
} from "@/lib/stale-version";
import { CustomerLocationDialog } from "./customer-location-dialog";
import type { EditableCustomerLocation } from "./customer-location-form";

const CUSTOMER_ID = "6f1c4d3a-0f2b-4d6a-9f1e-0a1b2c3d4e5f";
const LOCATION_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const UPDATED_AT = new Date("2026-01-01T00:00:00.000Z");

type SubmitHandler = (data: never) => Promise<void> | void;

const harness = vi.hoisted(() => ({
  update: vi.fn(),
  onSubmit: null as SubmitHandler | null,
  errorMessages: [] as (string | undefined)[],
  locationProps: [] as unknown[],
}));

vi.mock("@/components/forms/entity-select/quick-add-dialog-shell", () => ({
  QuickAddDialogShell: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/hooks/use-customers", () => ({
  useCreateCustomerLocation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateCustomerLocation: () => ({
    mutateAsync: harness.update,
    isPending: false,
  }),
}));

vi.mock("./customer-location-form", () => ({
  CustomerLocationForm: (props: {
    onSubmit: SubmitHandler;
    errorMessage?: string;
    location?: unknown;
  }) => {
    harness.onSubmit = props.onSubmit;
    harness.errorMessages.push(props.errorMessage);
    harness.locationProps.push(props.location);
    return null;
  },
}));

const location: EditableCustomerLocation = {
  id: LOCATION_ID,
  name: "Original field",
  country: "Tanzania",
  stateRegion: null,
  city: null,
  address: "E2E application site",
  gpsLatitude: -6.8,
  gpsLongitude: 39.28,
  distanceFromFacilityKm: 12.5,
  distanceSource: "manual",
  defaultSoilTemperatureC: 25,
  isDefault: true,
  updatedAt: UPDATED_AT,
};

const draft = {
  name: "Operator's unsaved rename",
  country: "Tanzania",
  stateRegion: null,
  city: null,
  address: "E2E application site",
  gpsLatitude: -6.8,
  gpsLongitude: 39.28,
  distanceFromFacilityKm: 12.5,
  distanceSource: "manual" as const,
  defaultSoilTemperatureC: 25,
  isDefault: true,
};

beforeEach(() => {
  harness.update.mockReset();
  harness.onSubmit = null;
  harness.errorMessages.length = 0;
  harness.locationProps.length = 0;
});

describe("CustomerLocationDialog on a stale-version refusal", () => {
  it("keeps the dialog and the draft, and shows the shared message", async () => {
    harness.update.mockRejectedValue(
      new StaleVersionError(STALE_VERSION_MESSAGE, {
        entity: "customerLocation",
        id: LOCATION_ID,
        code: STALE_VERSION_CONFLICT_CODE,
      }),
    );
    const onClose = vi.fn();

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <CustomerLocationDialog
          isOpen
          onClose={onClose}
          customerId={CUSTOMER_ID}
          location={location}
        />,
      );
    });

    await act(async () => {
      await harness.onSubmit?.(draft as never);
    });

    expect(harness.update).toHaveBeenCalledWith(
      expect.objectContaining({
        locationId: LOCATION_ID,
        expectedUpdatedAt: UPDATED_AT,
        name: draft.name,
      }),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(harness.errorMessages.at(-1)).toBe(STALE_VERSION_MESSAGE);
    // Same object on every render: no remount, no refetched values written
    // over the draft.
    expect(new Set(harness.locationProps).size).toBe(1);
    expect(harness.locationProps.at(-1)).toBe(location);

    await act(async () => {
      renderer?.unmount();
    });
  });
});
