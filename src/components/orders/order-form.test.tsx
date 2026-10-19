// @vitest-environment jsdom
/**
 * OrderForm customer field.
 *
 * The customer picker must stay searchable and server-paged: a fixed page of
 * customers silently drops everyone past the page and leaves no way to reach
 * them (#774).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { CustomerLocation, Facility, Order } from "@/db/schema";
import type { EntityOption, EntityType } from "@/components/forms/entity-select/types";
import type { RecordLockView } from "@/lib/record-lock-view";
import { OPEN_LOCK } from "../../../tests/helpers/record-lock-mocks";

const state = vi.hoisted(() => ({
  /** Every entity list request the form issues, in order. */
  optionRequests: [] as { entityType: EntityType; enabled: boolean }[],
  /** Every by-id request, so edit-mode preselection is observable. */
  detailRequests: [] as { entityType: EntityType; id: string | undefined }[],
  customersById: {} as Record<string, EntityOption>,
  locationOptions: [] as EntityOption[],
  locations: [] as CustomerLocation[],
  /** The selected customer's detail read; archived when `archivedAt` is set. */
  customer: undefined as { archivedAt: Date | null } | undefined,
  customerIsError: false,
  refetchCustomer: vi.fn(),
  editLocation: vi.fn(),
  facilities: [{ id: "facility", name: "Facility", timezone: "UTC" }] as Facility[],
}));

vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({
    facilityId: "facility",
    facilities: state.facilities,
    selectedFacility: state.facilities[0],
    activeOrganizationId: "org",
  }),
}));

vi.mock("@/hooks/use-organization-settings", () => ({
  useOrganizationDefaultValues: () => ({
    defaults: { defaultPackaging: "loose" },
    isLoading: false,
  }),
}));

vi.mock("@/hooks/use-customers", () => ({
  useCustomerLocations: () => ({ data: state.locations }),
  useCustomerWithRelations: () => ({ data: state.customer, isError: state.customerIsError, refetch: state.refetchCustomer }),
}));

vi.mock("@/components/orders/matching-output-bins", () => ({
  MatchingOutputBins: () => null,
}));

vi.mock("@/hooks/use-entities", () => ({
  useEntityOptions: ({
    entityType,
    enabled = true,
  }: {
    entityType: EntityType;
    enabled?: boolean;
  }) => {
    state.optionRequests.push({ entityType, enabled });
    return { data: enabled && entityType === "customerLocation" ? state.locationOptions : [], dataUpdatedAt: 0, isLoading: false, error: null };
  },
  useEntityById: (entityType: EntityType, id: string | undefined) => {
    state.detailRequests.push({ entityType, id });
    const data = entityType === "customerLocation"
      ? state.locationOptions.find((option) => option.id === id)
      : entityType === "customer" && id ? state.customersById[id] : null;
    return { data: data ?? null, dataUpdatedAt: 1, isPending: false };
  },
}));

vi.mock("@/components/customers/customer-location-dialog", () => ({
  CustomerLocationDialog: ({ customerId, location, facility, onClose }: { customerId: string; location: CustomerLocation; facility?: Facility; onClose: () => void }) => {
    state.editLocation({ customerId, location, facility });
    return <button type="button" onClick={onClose}>Close location editor</button>;
  },
}));

import { OrderForm } from "./order-form";

const noop = () => {};

function renderForm(order?: Order) {
  // The quick-add dialogs EntitySelect mounts (closed) read the query client.
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <OrderForm order={order} onSubmit={noop} lock={OPEN_LOCK} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.optionRequests = [];
  state.detailRequests = [];
  state.customersById = {};
  state.locationOptions = [];
  state.locations = [];
  state.customer = { archivedAt: null };
  state.customerIsError = false;
  state.refetchCustomer.mockClear();
  state.editLocation.mockClear();
  state.facilities = [{ id: "facility", name: "Facility", timezone: "UTC" } as Facility];
  Element.prototype.scrollIntoView = vi.fn();
  window.matchMedia = vi.fn().mockImplementation(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(cleanup);

describe("OrderForm product details", () => {
  it("requires an empty quantity and submits a typed quantity as a number", async () => {
    const submit = vi.fn();
    const client = new QueryClient();
    render(<QueryClientProvider client={client}>
      <OrderForm order={{
        id: "order-1", facilityId: "22222222-2222-4222-8222-222222222222",
        customerId: "33333333-3333-4333-8333-333333333333", customerLocationId: "11111111-1111-4111-8111-111111111111",
        formulationId: "44444444-4444-4444-8444-444444444444",
        orderDate: new Date("2026-09-01T00:00:00Z"), quantityKg: 1000, packaging: "loose",
      } as Order} onSubmit={submit} lock={OPEN_LOCK} />
    </QueryClientProvider>);
    const quantity = screen.getByRole("spinbutton", { name: /^Requested wet mass/ });
    fireEvent.change(quantity, { target: { value: "" } });
    fireEvent.submit(quantity.closest("form")!);
    await screen.findByText("Quantity is required");
    expect(submit).not.toHaveBeenCalled();

    fireEvent.change(quantity, { target: { value: "12.125" } });
    fireEvent.submit(quantity.closest("form")!);
    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ quantityKg: 12.125 })));
    expect(screen.queryByText("Quantity is required")).toBeNull();
    client.clear();
  });

  it("keeps the saved business day when the browser is west of UTC and submits a decoded Date", async () => {
    const originalTimezone = process.env.TZ;
    const client = new QueryClient();
    try {
      process.env.TZ = "America/Los_Angeles";
      const submit = vi.fn();
      render(<QueryClientProvider client={client}>
        <OrderForm order={{
          id: "order-1", facilityId: "22222222-2222-4222-8222-222222222222",
          customerId: "33333333-3333-4333-8333-333333333333", customerLocationId: "11111111-1111-4111-8111-111111111111",
          formulationId: "44444444-4444-4444-8444-444444444444",
          orderDate: new Date("2026-09-01T00:00:00Z"), quantityKg: 1000, packaging: "loose",
        } as Order} onSubmit={submit} lock={OPEN_LOCK} />
      </QueryClientProvider>);
      const date = screen.getByLabelText(/^Order date/) as HTMLInputElement;
      expect(date.value).toBe("2026-09-01");
      fireEvent.submit(date.closest("form")!);
      await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ orderDate: new Date("2026-09-01T00:00:00Z") })));
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimezone;
      client.clear();
    }
  });

  it("collects no price or currency", () => {
    const html = renderForm();

    expect(html).toContain('id="quantityKg"');
    expect(html).toContain('id="packaging"');
    expect(html).not.toContain('id="value"');
    expect(html).not.toContain('id="currency"');
    expect(html).not.toContain("Currency");
  });
});

describe("OrderForm customer field", () => {
  it("requires a location after the operator clears the customer's sole location", async () => {
    const locationId = "11111111-1111-4111-8111-111111111111";
    state.locationOptions = [{ id: locationId, code: "", name: "Only location" }];
    const submit = vi.fn();
    const client = new QueryClient();
    render(<QueryClientProvider client={client}>
      <OrderForm order={{
        id: "order-1", facilityId: "22222222-2222-4222-8222-222222222222",
        customerId: "33333333-3333-4333-8333-333333333333", customerLocationId: "",
        formulationId: "44444444-4444-4444-8444-444444444444",
        orderDate: "2026-09-01", quantityKg: 1000, packaging: "loose",
      } as unknown as Order} onSubmit={submit} lock={OPEN_LOCK} />
    </QueryClientProvider>);
    const picker = screen.getByRole("combobox", { name: /^Customer location/ });
    await waitFor(() => expect(picker.textContent).toBe("Only location"));
    fireEvent.click(within(picker.parentElement!).getByTestId("entity-select-clear"));
    expect(picker.textContent).toBe("Select location...");
    fireEvent.submit(picker.closest("form")!);
    await screen.findByText("Select a customer location.");
    expect(submit).not.toHaveBeenCalled();
    client.clear();
  });

  it("keeps the opening version fixed while refreshed detail data updates the selected label", () => {
    const location: CustomerLocation = {
      id: "location-1", customerId: "customer-1", name: "North field", country: "TZ", version: 1,
      facilityDistances: [], organizationId: "organization-1", gpsLatitude: -6.8, gpsLongitude: 39.2,
      address: null, city: null, stateRegion: null, defaultSoilTemperatureC: null, isDefault: true, archivedAt: null,
      createdAt: new Date("2026-09-12"), updatedAt: new Date("2026-09-12"),
    };
    state.locations = [location];
    state.locationOptions = [{ id: location.id, code: "", name: location.name! }];
    const orderFacility = { id: "order-facility", name: "Order facility", timezone: "UTC", gpsLatitude: -6.8, gpsLongitude: 39.2 } as Facility;
    state.facilities.push(orderFacility);
    const order = { facilityId: orderFacility.id, customerId: location.customerId, customerLocationId: location.id } as Order;
    const client = new QueryClient();
    const view = <QueryClientProvider client={client}><OrderForm order={order} onSubmit={noop} lock={OPEN_LOCK} /></QueryClientProvider>;
    const { rerender } = render(view);
    fireEvent.click(screen.getByRole("combobox", { name: /^Customer location/ }));
    fireEvent.click(screen.getByTestId("entity-select-edit"));
    expect(state.editLocation).toHaveBeenLastCalledWith({ customerId: location.customerId, location, facility: orderFacility });
    state.locations = [{ ...location, version: 2, name: "Renamed field" }];
    state.locationOptions = [{ ...state.locationOptions[0], name: "Renamed field" }];
    rerender(<QueryClientProvider client={client}><OrderForm order={order} onSubmit={noop} lock={OPEN_LOCK} /></QueryClientProvider>);
    expect(state.editLocation).toHaveBeenLastCalledWith({ customerId: location.customerId, location, facility: orderFacility });
    fireEvent.click(screen.getByRole("button", { name: "Close location editor" }));
    expect(screen.getByRole("combobox", { name: /^Customer location/ }).textContent).toBe("Renamed field");
    expect(state.optionRequests.filter((request) => request.entityType === "customerLocation").at(-1)?.enabled).toBe(false);
    expect(state.detailRequests).toContainEqual({ entityType: "customerLocation", id: location.id });
    client.clear();
  });

  it("offers no location edit until the scoped location record is available", () => {
    state.locationOptions = [{ id: "location-1", code: "", name: "North field" }];
    const client = new QueryClient();
    render(<QueryClientProvider client={client}><OrderForm order={{ customerId: "customer-1", customerLocationId: "location-1" } as Order} onSubmit={noop} lock={OPEN_LOCK} /></QueryClientProvider>);
    fireEvent.click(screen.getByRole("combobox", { name: /^Customer location/ }));
    expect(screen.queryByTestId("entity-select-edit")).toBeNull();
    client.clear();
  });

  it("renders a searchable combobox instead of a truncated native select", () => {
    const html = renderForm();

    // The FormField label names the trigger, so no aria-label overrides it.
    expect(html).toMatch(/<label[^>]*for="([^"]+)"/);
    const labelFor = html.match(/<label[^>]*for="([^"]+)"[^>]*>\s*Customer/)?.[1];
    expect(labelFor).toBeTruthy();
    expect(html).toContain(`id="${labelFor}"`);
    expect(html).toContain('role="combobox"');
    // A native <select id="customerId"> would be the fixed-page version.
    expect(html).not.toContain('id="customerId"');
  });

  it("never auto-selects a lone customer", () => {
    // autoSelectSingle would make the list query run while closed; requiring an
    // explicit pick keeps the order's attribution deliberate.
    const customerRequests = (renderForm(), state.optionRequests).filter(
      (request) => request.entityType === "customer",
    );

    expect(customerRequests).not.toHaveLength(0);
    expect(customerRequests.every((request) => request.enabled === false)).toBe(true);
  });

  it("preselects the existing customer by id in edit mode", () => {
    state.customersById["customer-1"] = {
      id: "customer-1",
      code: "C-001",
      name: "Kilimo Farms",
    };

    const html = renderForm({
      id: "order-1",
      facilityId: "facility",
      customerId: "customer-1",
      customerLocationId: "",
      formulationId: "formulation-1",
      orderDate: "2026-09-01",
      quantityKg: 1000,
      packaging: "loose",
    } as unknown as Order);

    expect(state.detailRequests).toContainEqual({
      entityType: "customer",
      id: "customer-1",
    });
    expect(html).toContain("Kilimo Farms");
  });
  describe("under an archived customer", () => {
    const location: CustomerLocation = {
      id: "location-1", customerId: "customer-1", name: "North field", country: "TZ", version: 1,
      facilityDistances: [], organizationId: "organization-1", gpsLatitude: -6.8, gpsLongitude: 39.2,
      address: null, city: null, stateRegion: null, defaultSoilTemperatureC: null, isDefault: true, archivedAt: null,
      createdAt: new Date("2026-09-12"), updatedAt: new Date("2026-09-12"),
    };
    const order = { customerId: "customer-1", customerLocationId: "location-1" } as Order;

    function renderArchived(archivedAt: Date | null) {
      state.locations = [location];
      state.locationOptions = [{ id: location.id, code: "", name: location.name! }, { id: "location-2", code: "", name: "South field" }];
      state.customer = { archivedAt };
      const client = new QueryClient();
      render(<QueryClientProvider client={client}><OrderForm order={order} onSubmit={noop} lock={OPEN_LOCK} /></QueryClientProvider>);
      return client;
    }

    it("shows the stored destination, refuses another one and hides location editing", () => {
      const client = renderArchived(new Date("2026-10-01"));
      const picker = screen.getByRole("combobox", { name: /^Customer location/ });
      expect(picker.textContent).toBe("North field");
      expect(picker.getAttribute("aria-readonly")).toBe("true");
      fireEvent.click(picker);
      expect(screen.queryByText("South field")).toBeNull();
      expect(screen.queryByTestId("entity-select-edit")).toBeNull();
      expect(screen.getByText("This customer is archived, so the customer location stays as stored. Restore the customer to change it.")).toBeTruthy();
      client.clear();
    });

    it("locks the destination and hides location editing while the customer is still loading", () => {
      state.locations = [location];
      state.locationOptions = [{ id: location.id, code: "", name: location.name! }, { id: "location-2", code: "", name: "South field" }];
      state.customer = undefined;
      const client = new QueryClient();
      render(<QueryClientProvider client={client}><OrderForm order={order} onSubmit={noop} lock={OPEN_LOCK} /></QueryClientProvider>);
      const picker = screen.getByRole("combobox", { name: /^Customer location/ });
      expect(picker.getAttribute("aria-readonly")).toBe("true");
      fireEvent.click(picker);
      expect(screen.queryByText("South field")).toBeNull();
      expect(screen.queryByTestId("entity-select-edit")).toBeNull();
      expect(screen.queryByText(/could not be loaded/)).toBeNull();
      client.clear();
    });

    it("keeps the destination locked and offers a retry when the customer read fails", () => {
      state.locations = [location];
      state.locationOptions = [{ id: location.id, code: "", name: location.name! }, { id: "location-2", code: "", name: "South field" }];
      state.customer = undefined;
      state.customerIsError = true;
      const client = new QueryClient();
      render(<QueryClientProvider client={client}><OrderForm order={order} onSubmit={noop} lock={OPEN_LOCK} /></QueryClientProvider>);
      const picker = screen.getByRole("combobox", { name: /^Customer location/ });
      expect(picker.getAttribute("aria-readonly")).toBe("true");
      expect(screen.queryByTestId("entity-select-edit")).toBeNull();
      expect(screen.getByText("The customer could not be loaded, so the customer location is locked. Try again.")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(state.refetchCustomer).toHaveBeenCalledTimes(1);
      client.clear();
    });

    it("offers no location editor for an archived destination and still lets an open order pick another one", () => {
      state.locations = [{ ...location, archivedAt: new Date("2026-10-01") }];
      state.locationOptions = [{ id: location.id, code: "", name: location.name! }, { id: "location-2", code: "", name: "South field" }];
      state.customer = { archivedAt: null };
      const client = new QueryClient();
      render(<QueryClientProvider client={client}><OrderForm order={order} onSubmit={noop} lock={OPEN_LOCK} /></QueryClientProvider>);
      const picker = screen.getByRole("combobox", { name: /^Customer location/ });
      expect(picker.getAttribute("aria-readonly")).toBeNull();
      fireEvent.click(picker);
      expect(screen.queryByTestId("entity-select-edit")).toBeNull();
      expect(screen.getByText("South field")).toBeTruthy();
      client.clear();
    });

    it("keeps the destination picker and location editing for an active customer", () => {
      const client = renderArchived(null);
      const picker = screen.getByRole("combobox", { name: /^Customer location/ });
      expect(picker.getAttribute("aria-readonly")).toBeNull();
      fireEvent.click(picker);
      expect(screen.getByTestId("entity-select-edit")).toBeTruthy();
      expect(screen.queryByText(/This customer is archived/)).toBeNull();
      client.clear();
    });
  });
});

describe("OrderForm record lock (#1119)", () => {
  const ORDER = {
    id: "order-1", facilityId: "22222222-2222-4222-8222-222222222222",
    customerId: "33333333-3333-4333-8333-333333333333", customerLocationId: "11111111-1111-4111-8111-111111111111",
    formulationId: "44444444-4444-4444-8444-444444444444",
    orderDate: new Date("2026-09-01T00:00:00Z"), quantityKg: 1000, packaging: "loose",
  } as Order;
  const DELIVERY = { kind: "delivery", id: "55555555-5555-4555-8555-555555555555", label: "DL-26-004", facilityId: "22222222-2222-4222-8222-222222222222" };
  const lockAt = (level: RecordLockView["level"]): RecordLockView => ({
    level,
    heldBy: level === "open" ? [] : [DELIVERY],
    usedBy: level === "open" ? [] : [DELIVERY],
    freeFields: level === "sent" ? [] : ["code", "quantityKg", "orderDate", "packaging"],
    howToFree: level === "open" ? null : "To change them, first correct or remove those records.",
    returnedBy: [],
  });

  function renderLocked(level: RecordLockView["level"] | "pending") {
    const client = new QueryClient();
    render(<QueryClientProvider client={client}>
      <OrderForm order={ORDER} onSubmit={noop} lock={level === "pending" ? undefined : lockAt(level)} />
    </QueryClientProvider>);
    return {
      customer: screen.getByRole("combobox", { name: /^Customer(Required)?$/ }),
      location: screen.getByRole("combobox", { name: /^Customer location/ }),
      formulation: screen.getByRole("combobox", { name: /^Formulation/ }),
      date: screen.getByLabelText(/^Order date/) as HTMLInputElement,
      quantity: screen.getByRole("spinbutton", { name: /^Requested wet mass/ }) as HTMLInputElement,
      packaging: screen.getByRole("combobox", { name: /^Packaging/ }) as HTMLSelectElement,
    };
  }
  const isDisabled = (element: HTMLElement) => element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true";

  it("leaves every field editable and shows no lock line while Open", () => {
    const fields = renderLocked("open");
    expect(Object.values(fields).some(isDisabled)).toBe(false);
    expect(document.querySelector("[data-record-lock-notice]")).toBeNull();
  });

  // The lock line itself renders once, from the sheet (`editNotice`).
  it("disables the fields a delivery holds while In use", () => {
    const fields = renderLocked("inUse");
    expect([fields.customer, fields.location, fields.formulation].every(isDisabled)).toBe(true);
    expect([fields.date, fields.quantity, fields.packaging].some(isDisabled)).toBe(false);
  });

  it("keeps the fields a delivery would hold closed until the lock answers", () => {
    const fields = renderLocked("pending");
    expect([fields.customer, fields.location, fields.formulation].every(isDisabled)).toBe(true);
    expect([fields.date, fields.quantity, fields.packaging].some(isDisabled)).toBe(false);
  });

  it("disables every field while Sent", () => {
    const fields = renderLocked("sent");
    expect(Object.values(fields).every(isDisabled)).toBe(true);
  });
});
