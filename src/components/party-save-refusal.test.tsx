// @vitest-environment jsdom
/**
 * Customer, supplier, their location forms and the supplier quick-add dialog
 * show a refused save at the field it names (#1327). Paths follow what the
 * server sends: create wraps the party in `customer` / `supplier`, the quick
 * add wraps its one location in `locations.0`. Cases marked as contracts feed
 * the form a shape no action sends today, to pin the form's side of it.
 */
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/action-error";
import type { SaveRefusalHandler } from "@/components/forms/use-save-refusal";
import { CustomerForm } from "./customers/customer-form";
import { CustomerLocationForm } from "./customers/customer-location-form";
import { SupplierForm } from "./suppliers/supplier-form";
import { SupplierLocationForm } from "./suppliers/supplier-location-form";
import { SupplierQuickAddDialog } from "./forms/entity-select/supplier-quick-add-dialog";

const mocks = vi.hoisted(() => ({
  callbacks: undefined as { onError?: (error: Error, variables: unknown) => void } | undefined,
  mutateAsync: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  InfoHint: () => null,
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }) }));
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityContext: () => ({ facilities: [], selectedFacility: undefined }) }));
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
  useUpdateCustomerLocation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useArchiveCustomerLocation: () => ({ isPending: false }),
  useRestoreCustomerLocation: () => ({ isPending: false }),
}));

const LOCK_REASON = "This location is registered with Isometric as a storage site, so its name and coordinates cannot change. Add a new location instead.";
const LOCKED = "Locked. Your change was not saved.";
const ID = "6f1c4d3a-0f2b-4d6a-9f1e-0a1b2c3d4e5f";

const issue = (path: (string | number)[], message: string, code = "validation_failed") => ({ path, code, message });
const refusal = (issues: ReturnType<typeof issue>[], code: "validation_failed" | "certification_locked" = "validation_failed") =>
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
});

const save = (name: string) => act(async () => {
  fireEvent.click(screen.getByRole("button", { name }));
});

/** By name or id: the GPS inputs carry only an id, and the quick add renders in a portal. */
const input = (_container: HTMLElement, name: string) =>
  document.querySelector<HTMLInputElement>(`[name="${name}"], [id="${name}"]`)!;
const LATITUDE = "gps-latitude";
const LONGITUDE = "gps-longitude";
const QUICK_ADD_LATITUDE = "supplier-quick-add-position-latitude";
const QUICK_ADD_LONGITUDE = "supplier-quick-add-position-longitude";

function Footer({ value }: { value: string | null }) {
  return value ? <p data-testid="footer">{value}</p> : null;
}

describe("CustomerForm", () => {
  it("lands a create refusal on customer.name at the name field with no footer", async () => {
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

  it("lands an update refusal on a flat field path", async () => {
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
  it("lands a create refusal on supplier.name at the name field with no footer", async () => {
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
  it("lands a field-named refusal at its field and leaves the fields editable", async () => {
    const footers: Array<string | null> = [];
    const { container } = render(
      <CustomerLocationForm location={savedCustomerLocation} onSubmit={withFooter(refusal([issue(["city"], "City is not recognised.")]), footers)} />,
    );
    await save("Update location");
    expect(await screen.findByText("City is not recognised.")).toBeTruthy();
    expect(footers).toEqual([null]);
    expect(input(container, "name").disabled).toBe(false);
  });

  it("reverts a registered site's name, says Locked and switches name and GPS off", async () => {
    const footers: Array<string | null> = [];
    const lock = refusal([issue(["name"], LOCK_REASON, "certification_locked")], "certification_locked");
    const { container } = render(<CustomerLocationForm location={savedCustomerLocation} onSubmit={withFooter(lock, footers)} />);
    fireEvent.change(input(container, "name"), { target: { value: "Renamed" } });
    fireEvent.change(input(container, LATITUDE), { target: { value: "9.5" } });
    await save("Update location");
    expect((await screen.findAllByText(LOCKED)).length).toBe(2);
    expect(input(container, "name").value).toBe("Block A");
    expect(input(container, LATITUDE).value).toBe("1.5");
    expect(input(container, "name").disabled).toBe(true);
    expect(input(container, LATITUDE).disabled).toBe(true);
    expect(input(container, LONGITUDE).disabled).toBe(true);
    expect(footers).toEqual([LOCK_REASON]);
  });
});

describe("SupplierLocationForm", () => {
  it("lands a field-named refusal at its field with no footer", async () => {
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

  async function submitDraft(container: HTMLElement) {
    fireEvent.change(input(container, "supplier-quick-add-name"), { target: { value: "Supplier" } });
    fireEvent.change(input(container, QUICK_ADD_LATITUDE), { target: { value: "47.3769" } });
    fireEvent.change(input(container, QUICK_ADD_LONGITUDE), { target: { value: "8.5417" } });
    mocks.mutateAsync.mockImplementation(async (payload: unknown) => {
      const error = refusal([issue(["locations", 0, "gpsLatitude"], "Position is outside the country.")]);
      await mocks.callbacks?.onError?.(error, payload);
      throw error;
    });
    await save("Create supplier");
  }

  it("lands locations.0.* on the flat GPS field with no footer", async () => {
    const { container } = render(<Dialog />);
    await submitDraft(container);
    expect(await screen.findByText("Position is outside the country.")).toBeTruthy();
    expect(screen.queryByText("FALLBACK")).toBeNull();
  });

  it("ignores a refusal of a payload that is no longer the active one", async () => {
    const { container } = render(<Dialog />);
    fireEvent.change(input(container, "supplier-quick-add-name"), { target: { value: "Supplier" } });
    await act(async () => {
      mocks.callbacks?.onError?.(refusal([issue(["locations", 0, "gpsLatitude"], "Stale refusal.")]), {});
    });
    expect(screen.queryByText("Stale refusal.")).toBeNull();
  });
});
