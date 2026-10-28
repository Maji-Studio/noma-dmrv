// @vitest-environment jsdom
/**
 * An untouched New Feedstock form stays clean after the selects pick a lone
 * facility and feedstock type for the operator, so Cancel closes without
 * "Discard unsaved changes?" (#1360). Real form, real selects; only the data
 * hooks and the trailing sections are stubbed.
 */
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EntityOption, EntityType } from "@/components/forms/entity-select/types";
import { expectStayedClean, renderReportingDirty } from "../../../tests/helpers/form-dialog-dirty";
import { FeedstockForm } from "./feedstock-form";

const state = vi.hoisted(() => ({
  contextFacilityId: "" as string,
  options: {} as Partial<Record<EntityType, EntityOption[]>>,
}));
vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({ facilityId: state.contextFacilityId || null }),
  useFacilityClock: () => ({ timeZone: "UTC", hint: "" }),
}));
vi.mock("@/hooks/use-refresh-entity-options-on-return", () => ({ useRefreshEntityOptionsOnReturn: () => () => {} }));
vi.mock("@/hooks/use-entities", () => ({
  useEntityOptions: ({ entityType }: { entityType: EntityType }) => ({ data: state.options[entityType] ?? [], isLoading: false, error: null }),
  useEntityById: (entityType: EntityType, id: string | undefined) => ({
    data: (state.options[entityType] ?? []).find((option) => option.id === id), isPending: false,
  }),
}));
vi.mock("@/hooks/use-entity-edit-record", () => ({ isEditableEntityType: () => false, useCanManageFeedstockTypes: () => false }));
vi.mock("@/hooks/use-suppliers", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/hooks/use-suppliers")>(),
  useSupplier: () => ({ data: undefined }),
  useSupplierLocationsBySupplier: () => ({ data: [] }),
}));
vi.mock("@/hooks/use-transport-legs", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/hooks/use-transport-legs")>(),
  useTransportLegsForEntity: () => ({ data: [] }),
}));
vi.mock("@/hooks/use-facilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/hooks/use-facilities")>(),
  useFacility: () => ({ data: undefined }),
}));
vi.mock("@/hooks/use-geo", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/hooks/use-geo")>(),
  useGeoCapabilities: () => ({ data: undefined }),
  useRouteDistance: () => ({ data: undefined }),
}));
vi.mock("@/components/transport-legs", () => ({ TransportRoutePreview: () => null }));
vi.mock("@/components/credit-batches/record-credit-batch-line", () => ({ RecordCreditBatchLine: () => null }));
vi.mock("./feedstock-trailing-sections", () => ({ FeedstockEvidenceSection: () => null }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: () => null,
  Tooltip: ({ children }: { children: ReactNode }) => children,
}));

const FACILITY: EntityOption = { id: "facility-one", code: "F1", name: "North site" };
const WOOD_CHIPS: EntityOption = { id: "feedstock-one", code: "WC", name: "Wood chips" };
const HUSKS: EntityOption = { id: "feedstock-two", code: "RH", name: "Rice husks" };

beforeEach(() => {
  state.contextFacilityId = "facility-one";
  state.options = { feedstockType: [WOOD_CHIPS], facility: [FACILITY] };
  Element.prototype.scrollIntoView = vi.fn();
  window.matchMedia = vi.fn().mockImplementation(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(cleanup);

// The quick-add dialogs the selects mount (closed) read the query client.
function queryWrapper() {
  const client = new QueryClient();
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}
const dirtyStates = () => renderReportingDirty(<FeedstockForm onSubmit={vi.fn()} onCancel={vi.fn()} />, { wrapper: queryWrapper() }).states;
const select = (name: RegExp) => screen.getByRole("combobox", { name });

describe("FeedstockForm unsaved changes", () => {
  it("stays clean when the only feedstock type is picked for the operator", async () => {
    const states = dirtyStates();
    await waitFor(() => expect(select(/^Feedstock type/).textContent).toBe("Wood chips"));
    expectStayedClean(states);
  });

  it("stays clean when the only facility is picked too, outside a facility context", async () => {
    state.contextFacilityId = "";
    const states = dirtyStates();
    await waitFor(() => expect(select(/^Facility/).textContent).toBe("North site"));
    await waitFor(() => expect(select(/^Feedstock type/).textContent).toBe("Wood chips"));
    expectStayedClean(states);
  });

  it("turns dirty once the operator picks a feedstock type", async () => {
    state.options = { feedstockType: [WOOD_CHIPS, HUSKS] };
    const states = dirtyStates();
    fireEvent.click(select(/^Feedstock type/));
    fireEvent.click(screen.getByTestId("entity-option-feedstock-two"));
    await waitFor(() => expect(states.at(-1)).toBe(true));
  });
});
