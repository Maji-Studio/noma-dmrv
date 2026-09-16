/**
 * OrderForm customer field.
 *
 * The customer picker must stay searchable and server-paged: a fixed page of
 * customers silently drops everyone past the page and leaves no way to reach
 * them (#774).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "@/db/schema";
import type { EntityOption, EntityType } from "@/components/forms/entity-select/types";

const state = vi.hoisted(() => ({
  /** Every entity list request the form issues, in order. */
  optionRequests: [] as { entityType: EntityType; enabled: boolean }[],
  /** Every by-id request, so edit-mode preselection is observable. */
  detailRequests: [] as { entityType: EntityType; id: string | undefined }[],
  customersById: {} as Record<string, EntityOption>,
}));

vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({
    facilityId: "facility",
    facilities: [{ id: "facility", name: "Facility", timezone: "UTC" }],
    activeOrganizationId: "org",
  }),
}));

vi.mock("@/hooks/use-organization-settings", () => ({
  useOrganizationDefaultValues: () => ({
    defaults: { defaultPackaging: "loose", defaultCurrency: "TZS" },
    isLoading: false,
  }),
}));

vi.mock("@/hooks/use-customers", () => ({
  useCustomerLocations: () => ({ data: [] }),
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
    return { data: [], dataUpdatedAt: 0, isLoading: false, error: null };
  },
  useEntityById: (entityType: EntityType, id: string | undefined) => {
    state.detailRequests.push({ entityType, id });
    const data = entityType === "customer" && id ? state.customersById[id] : null;
    return { data: data ?? null, dataUpdatedAt: 1, isPending: false };
  },
}));

import { OrderForm } from "./order-form";

const noop = () => {};

function renderForm(order?: Order) {
  // The quick-add dialogs EntitySelect mounts (closed) read the query client.
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <OrderForm order={order} onSubmit={noop} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.optionRequests = [];
  state.detailRequests = [];
  state.customersById = {};
});

describe("OrderForm customer field", () => {
  it("renders a searchable combobox instead of a truncated native select", () => {
    const html = renderForm();

    expect(html).toContain('aria-label="Select customer..."');
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
      value: null,
      currency: "TZS",
    } as unknown as Order);

    expect(state.detailRequests).toContainEqual({
      entityType: "customer",
      id: "customer-1",
    });
    expect(html).toContain("Kilimo Farms");
  });
});
