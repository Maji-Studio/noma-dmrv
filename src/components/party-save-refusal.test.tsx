// @vitest-environment jsdom
/**
 * Customer, supplier, their location forms and the supplier quick-add dialog
 * show a refused save at the field it names (#1327). Paths follow what the
 * server sends: create wraps the party in `customer` / `supplier`, the quick
 * add wraps its one location in `locations.0`. Cases marked as contracts feed
 * the form a shape no action sends today, to pin the form's side of it.
 */
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/action-error";
import type { SaveRefusalHandler } from "@/components/forms/use-save-refusal";
import { CustomerLocationDialog } from "./customers/customer-location-dialog";
import { CustomerForm } from "./customers/customer-form";
import { CustomerLocationForm } from "./customers/customer-location-form";
import { SupplierForm } from "./suppliers/supplier-form";
import { SupplierLocationForm } from "./suppliers/supplier-location-form";
import { SupplierQuickAddDialog } from "./forms/entity-select/supplier-quick-add-dialog";

const mocks = vi.hoisted(() => ({
  callbacks: undefined as { onError?: (error: Error, variables: unknown) => void } | undefined,
  mutateAsync: vi.fn(),
  updateCustomerLocation: vi.fn(),
  facilities: [] as unknown[],
}));

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  InfoHint: () => null,
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }) }));
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityContext: () => ({ facilities: mocks.facilities, selectedFacility: mocks.facilities[0] }) }));
vi.mock("@/hooks/use-organization-settings", () => ({ useOrganizationDefaultValues: () => ({ defaults: { defaultCountry: "Tanzania" } }) }));
vi.mock("@/hooks/use-geo", () => ({
  useGeoCapabilities: () => ({ data: { routingConfigured: false } }),
  useRouteDistance: () => ({ isPending: false, isError: false }),
  useGeocodeSearch: () => ({ data: undefined, isError: false, isFetching: false }),
  useReverseGeocode: () => ({ data: null }),
}));
vi.mock("@/hooks/use-suppliers", () => ({
  useSupplierLocationsBySupplier: () => ({ data: [], isLoading: false, isError: false }),
  useDeleteSupplierLocation: () => ({ isPending: false }),
  useCreateSupplierLocation: () => ({ startDraft: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useUpdateSupplierLocation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateSupplierWithLocations: (callbacks: typeof mocks.callbacks) => {
    mocks.callbacks = callbacks;
    return { startDraft: vi.fn(), mutateAsync: mocks.mutateAsync, isPending: false };
  },
}));
vi.mock("@/hooks/use-customers", () => ({
  useCustomerLocations: () => ({ data: [], isLoading: false, isError: false }),
  useDeleteCustomerLocation: () => ({ isPending: false }),
  useCreateCustomerLocation: () => ({ startDraft: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useUpdateCustomerLocation: () => ({ mutateAsync: mocks.updateCustomerLocation, isPending: false }),
  useArchiveCustomerLocation: () => ({ isPending: false }),
  useRestoreCustomerLocation: () => ({ isPending: false }),
}));

const LOCK_REASON = "This location is registered with Isometric as a storage site, so its name and coordinates cannot change. Add a new location instead.";
const LOCKED = "Locked. Your change was not saved.";
const ID = "6f1c4d3a-0f2b-4d6a-9f1e-0a1b2c3d4e5f";

const issue = (path: (string | number)[], message: string, code = "validation_failed") => ({ path, code, message });
const refusal = (issues: ReturnType<typeof issue>[], code: "validation_failed" | "certification_locked" | "conflict" = "validation_failed") =>
  new ActionError({ error: issues[0]?.message ?? "Refused", code, issues });

/** What a parent does with the form's handler: keep the footer it returns, null included. */
function withFooter<D>(error: unknown, footers: Array<string | null>) {
  return async (_data: D, onRefusal: SaveRefusalHandler) => {
    footers.push(onRefusal(error, "FALLBACK"));
  };
}

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  mocks.mutateAsync.mockReset();
  mocks.updateCustomerLocation.mockReset();
  mocks.facilities = [];
});

const save = (name: string) => act(async () => {
  fireEvent.click(screen.getByRole("button", { name }));
});

/** By name or id: the GPS inputs carry only an id, and the quick add renders in a portal. */
const input = (name: string) =>
  document.querySelector<HTMLInputElement>(`[name="${name}"], [id="${name}"], [data-field-name="${name}"]`)!;
const LATITUDE = "gps-latitude";
const LONGITUDE = "gps-longitude";
const QUICK_ADD_LATITUDE = "supplier-quick-add-position-latitude";
const QUICK_ADD_LONGITUDE = "supplier-quick-add-position-longitude";

describe("CustomerForm", () => {
  it("form contract: customer.name (the create shape) lands at the name field with no footer", async () => {
    const footers: Array<string | null> = [];
    const onSubmit = withFooter(refusal([issue(["customer", "name"], "A customer with this name already exists.")]), footers);
    render(
      <NuqsTestingAdapter>
        <CustomerForm customer={{ name: "Old" } as never} onSubmit={onSubmit} />
      </NuqsTestingAdapter>,
    );
    await save("Update customer");
    expect(await screen.findByText("A customer with this name already exists.")).toBeTruthy();
    expect(footers).toEqual([null]);
  });

  it("form contract: a flat contactEmail path lands at its field with no footer", async () => {
    const footers: Array<string | null> = [];
    render(
      <NuqsTestingAdapter>
        <CustomerForm customer={{ name: "Old" } as never} customerId={ID} onSubmit={withFooter(refusal([issue(["contactEmail"], "Email is taken.")]), footers)} />
      </NuqsTestingAdapter>,
    );
    await save("Update customer");
    expect(await screen.findByText("Email is taken.")).toBeTruthy();
    expect(footers).toEqual([null]);
  });

  it("lands a real name conflict (flat name path, code conflict, no conflict ref) at the field with no footer", async () => {
    const footers: Array<string | null> = [];
    render(
      <NuqsTestingAdapter>
        <CustomerForm customer={{ name: "Old" } as never} customerId={ID} onSubmit={withFooter(refusal([issue(["name"], "A customer with this name already exists.", "conflict")], "conflict"), footers)} />
      </NuqsTestingAdapter>,
    );
    await save("Update customer");
    expect(await screen.findByText("A customer with this name already exists.")).toBeTruthy();
    expect(footers).toEqual([null]);
  });

  it("keeps the caller's fallback for a refusal that names no field", async () => {
    const footers: Array<string | null> = [];
    render(
      <NuqsTestingAdapter>
        <CustomerForm customer={{ name: "Old" } as never} customerId={ID} onSubmit={withFooter(new Error("boom"), footers)} />
      </NuqsTestingAdapter>,
    );
    await save("Update customer");
    expect(footers).toEqual(["FALLBACK"]);
  });
});

describe("SupplierForm", () => {
  it("form contract: supplier.name (the create shape) lands at the name field with no footer", async () => {
    const footers: Array<string | null> = [];
    render(
      <NuqsTestingAdapter>
        <SupplierForm supplier={{ name: "Old" } as never} supplierId={ID} onSubmit={withFooter(refusal([issue(["supplier", "name"], "A supplier with this name already exists.")]), footers)} />
      </NuqsTestingAdapter>,
    );
    await save("Update supplier");
    expect(await screen.findByText("A supplier with this name already exists.")).toBeTruthy();
    expect(footers).toEqual([null]);
  });
});

const savedCustomerLocation = {
  name: "Block A", country: "Tanzania", gpsLatitude: 1.5, gpsLongitude: 2.5,
  stateRegion: null, city: null, address: null, defaultSoilTemperatureC: null, isDefault: false, facilityDistances: [],
};

describe("CustomerLocationForm", () => {
  it("form contract: a city path lands at its field and leaves the fields editable", async () => {
    const footers: Array<string | null> = [];
    render(
      <CustomerLocationForm location={savedCustomerLocation} onSubmit={withFooter(refusal([issue(["city"], "City is not recognised.")]), footers)} />,
    );
    await save("Update location");
    expect(await screen.findByText("City is not recognised.")).toBeTruthy();
    expect(footers).toEqual([null]);
    expect(input("name").disabled).toBe(false);
  });

  const siteLock = (...fields: string[]) =>
    refusal(fields.map((field) => issue([field], LOCK_REASON, "certification_locked")), "certification_locked");

  it("reverts every changed field the storage-site lock names, says Locked and switches name and GPS off", async () => {
    const footers: Array<string | null> = [];
    render(<CustomerLocationForm location={savedCustomerLocation} onSubmit={withFooter(siteLock("name", "gpsLatitude"), footers)} />);
    fireEvent.change(input("name"), { target: { value: "Renamed" } });
    fireEvent.change(input(LATITUDE), { target: { value: "9.5" } });
    await save("Update location");
    expect((await screen.findAllByText(LOCKED)).length).toBe(2);
    expect(input("name").value).toBe("Block A");
    expect(input(LATITUDE).value).toBe("1.5");
    expect(input("name").disabled).toBe(true);
    expect(input(LATITUDE).disabled).toBe(true);
    expect(input(LONGITUDE).disabled).toBe(true);
    expect(footers).toEqual([LOCK_REASON]);
  });

  it("keeps the reason on screen after the next save clears the footer", async () => {
    const refusals = [siteLock("name"), refusal([issue(["city"], "City is not recognised.")])];
    const footers: Array<string | null> = [];
    render(
      <CustomerLocationForm
        location={savedCustomerLocation}
        onSubmit={async (_data, onRefusal) => { footers.push(onRefusal(refusals.shift(), "FALLBACK")); }}
      />,
    );
    fireEvent.change(input("name"), { target: { value: "Renamed" } });
    await save("Update location");
    await screen.findAllByText(LOCKED);
    expect(screen.getAllByText(LOCK_REASON).length).toBeGreaterThanOrEqual(1);
    await save("Update location");
    expect(await screen.findByText("City is not recognised.")).toBeTruthy();
    expect(footers).toEqual([LOCK_REASON, null]);
    expect(screen.getAllByText(LOCK_REASON)).toHaveLength(1);
    expect(input("name").disabled).toBe(true);
  });

  it("does not lock the site for a certification lock on another field", async () => {
    const footers: Array<string | null> = [];
    render(<CustomerLocationForm location={savedCustomerLocation} onSubmit={withFooter(siteLock("city"), footers)} />);
    fireEvent.change(input("name"), { target: { value: "Renamed" } });
    await save("Update location");
    await waitFor(() => expect(footers).toEqual([LOCK_REASON]));
    expect(input("name").disabled).toBe(false);
    expect(input("name").value).toBe("Renamed");
    expect(input(LATITUDE).disabled).toBe(false);
  });
});

describe("SupplierLocationForm", () => {
  it("form contract: a city path lands at its field with no footer", async () => {
    const footers: Array<string | null> = [];
    render(
      <SupplierLocationForm
        location={{ ...savedCustomerLocation, supplierId: ID } as never}
        onSubmit={withFooter(refusal([issue(["city"], "City is not recognised.")]), footers)}
      />,
    );
    await save("Update location");
    expect(await screen.findByText("City is not recognised.")).toBeTruthy();
    expect(footers).toEqual([null]);
  });
});

describe("SupplierQuickAddDialog", () => {
  function Dialog() {
    const [open] = useState(true);
    return <SupplierQuickAddDialog isOpen={open} onClose={vi.fn()} />;
  }

  async function submitDraft() {
    fireEvent.change(input("supplier-quick-add-name"), { target: { value: "Supplier" } });
    fireEvent.change(input(QUICK_ADD_LATITUDE), { target: { value: "47.3769" } });
    fireEvent.change(input(QUICK_ADD_LONGITUDE), { target: { value: "8.5417" } });
    mocks.mutateAsync.mockImplementation(async (payload: unknown) => {
      const error = refusal([issue(["locations", 0, "gpsLatitude"], "Position is outside the country.")]);
      await mocks.callbacks?.onError?.(error, payload);
      throw error;
    });
    await save("Create supplier");
  }

  it("lands locations.0.* on the flat GPS field with no footer", async () => {
    render(<Dialog />);
    await submitDraft();
    // Once, at the field: a footer copy (no alias) would make it two and leave the input valid.
    expect(await screen.findAllByText("Position is outside the country.")).toHaveLength(1);
    expect(input(QUICK_ADD_LATITUDE).getAttribute("aria-invalid")).toBe("true");
  });

  it("ignores a refusal of a payload that is no longer the active one", async () => {
    render(<Dialog />);
    fireEvent.change(input("supplier-quick-add-name"), { target: { value: "Supplier" } });
    await act(async () => {
      mocks.callbacks?.onError?.(refusal([issue(["locations", 0, "gpsLatitude"], "Stale refusal.")]), {});
    });
    expect(screen.queryByText("Stale refusal.")).toBeNull();
  });
});

const plants = [
  { id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", name: "First plant", gpsLatitude: 1, gpsLongitude: 2 },
  { id: "11111111-2222-4333-8444-555555555555", name: "Second plant", gpsLatitude: 3, gpsLongitude: 4 },
];
const FIRST_ROW = "facilityDistances.0.distanceKm";
const SECOND_ROW = "facilityDistances.1.distanceKm";

describe("facility distance rows", () => {
  beforeEach(() => {
    mocks.facilities = plants;
  });

  it.each([
    ["facilityId", "customer", () => CustomerLocationForm, savedCustomerLocation],
    ["distanceSource", "customer", () => CustomerLocationForm, savedCustomerLocation],
    ["facilityId", "supplier", () => SupplierLocationForm, { ...savedCustomerLocation, supplierId: ID }],
    ["distanceKm", "supplier", () => SupplierLocationForm, { ...savedCustomerLocation, supplierId: ID }],
  ])("lands a %s refusal of a %s location on the refused row, not the footer", async (field, _party, form, location) => {
    const Form = form() as typeof CustomerLocationForm;
    const footers: Array<string | null> = [];
    const row = refusal([issue(["facilityDistances", 1, field], "Facility is archived.")]);
    render(<Form location={location as never} onSubmit={withFooter(row, footers)} />);
    await save("Update location");
    expect(await screen.findAllByText("Facility is archived.")).toHaveLength(1);
    expect(input(SECOND_ROW).getAttribute("aria-invalid")).toBe("true");
    expect(input(FIRST_ROW).getAttribute("aria-invalid")).toBe("false");
    expect(footers).toEqual([null]);
  });

  it("lands a locations.0.facilityDistances row of the quick add on the refused row", async () => {
    render(<SupplierQuickAddDialog isOpen onClose={vi.fn()} />);
    fireEvent.change(input("supplier-quick-add-name"), { target: { value: "Supplier" } });
    fireEvent.change(input(QUICK_ADD_LATITUDE), { target: { value: "47.3769" } });
    fireEvent.change(input(QUICK_ADD_LONGITUDE), { target: { value: "8.5417" } });
    mocks.mutateAsync.mockImplementation(async (payload: unknown) => {
      const error = refusal([issue(["locations", 0, "facilityDistances", 0, "facilityId"], "Facility is archived.")]);
      await mocks.callbacks?.onError?.(error, payload);
      throw error;
    });
    await save("Create supplier");
    expect(await screen.findAllByText("Facility is archived.")).toHaveLength(1);
    expect(input(FIRST_ROW).getAttribute("aria-invalid")).toBe("true");
  });
});

const siteLockOf = (field: string) => refusal([issue([field], LOCK_REASON, "certification_locked")], "certification_locked");

describe("CustomerLocationDialog", () => {
  const at = (id: string, name: string, extra: object = {}) => ({
    ...savedCustomerLocation, id, name, version: 1, updatedAt: new Date("2026-01-01"), ...extra,
  });
  const NAME = "customer-location-dialog-name";
  const dialog = (location: ReturnType<typeof at>) => (
    <CustomerLocationDialog isOpen onClose={vi.fn()} customerId={ID} location={location as never} />
  );

  it("passes a field-named refusal to the form and keeps the footer empty", async () => {
    mocks.updateCustomerLocation.mockRejectedValue(refusal([issue(["city"], "City is not recognised.")]));
    render(dialog(at("loc-a", "Block A")));
    await save("Save changes");
    expect(await screen.findAllByText("City is not recognised.")).toHaveLength(1);
    expect(screen.queryByText("Location was not saved. Try again.")).toBeNull();
  });

  it("does not carry a lock on one location over to the next one opened", async () => {
    mocks.updateCustomerLocation.mockRejectedValue(siteLockOf("name"));
    const { rerender } = render(dialog(at("loc-a", "Block A")));
    fireEvent.change(input(NAME), { target: { value: "Renamed" } });
    await save("Save changes");
    await screen.findAllByText(LOCKED);
    expect(input(NAME).disabled).toBe(true);
    rerender(dialog(at("loc-b", "Block B")));
    expect(input(NAME).value).toBe("Block B");
    expect(input(NAME).disabled).toBe(false);
    expect(screen.queryByText(LOCKED)).toBeNull();
  });

  it("maps a row index of the changed pairs back to the form row of that facility", async () => {
    mocks.facilities = plants;
    const saved = [{ facilityId: plants[0].id, distanceKm: 5, distanceSource: "manual" as const }];
    // Only the second plant changed, so the server sees it as row 0 of the payload.
    mocks.updateCustomerLocation.mockRejectedValue(refusal([issue(["facilityDistances", 0, "facilityId"], "Facility is archived.")]));
    render(dialog(at("loc-a", "Block A", { facilityDistances: saved })));
    fireEvent.change(input(`customer-location-dialog-distance-${plants[1].id}`), { target: { value: "9" } });
    await save("Save changes");
    expect(await screen.findAllByText("Facility is archived.")).toHaveLength(1);
    expect(input(SECOND_ROW).getAttribute("aria-invalid")).toBe("true");
    expect(input(FIRST_ROW).getAttribute("aria-invalid")).toBe("false");
  });
});
