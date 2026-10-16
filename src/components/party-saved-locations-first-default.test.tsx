/**
 * The saved-locations dialog starts "default" checked only for a loaded, empty
 * list (issue #944). A list that is still loading or failed to load must not
 * read as empty, or a new location would take the default from an existing one.
 */

import { act, create } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CustomerForm } from "./customers/customer-form";
import { SupplierForm } from "./suppliers/supplier-form";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));

const harness = vi.hoisted(() => ({
  query: { data: undefined as unknown[] | undefined, isLoading: false, isError: false },
  isFirstLocation: undefined as boolean | undefined,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  InfoHint: () => null,
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({}) }));
vi.mock("@/hooks/use-suppliers", () => ({
  useSupplierLocationsBySupplier: () => harness.query,
  useDeleteSupplierLocation: () => ({ isPending: false }),
}));
vi.mock("@/hooks/use-customers", () => ({
  useCustomerLocations: () => harness.query,
  useDeleteCustomerLocation: () => ({ isPending: false }),
}));
vi.mock("./suppliers/supplier-location-dialog", () => ({
  SupplierLocationDialog: (props: { isFirstLocation?: boolean }) => {
    harness.isFirstLocation = props.isFirstLocation;
    return null;
  },
}));
vi.mock("./customers/customer-location-dialog", () => ({
  CustomerLocationDialog: (props: { isFirstLocation?: boolean }) => {
    harness.isFirstLocation = props.isFirstLocation;
    return null;
  },
}));

const ID = "6f1c4d3a-0f2b-4d6a-9f1e-0a1b2c3d4e5f";

describe.each([
  ["supplier", () => <SupplierForm supplier={{ name: "S" } as never} supplierId={ID} onSubmit={vi.fn()} />],
  ["customer", () => <CustomerForm customer={{ name: "C" } as never} customerId={ID} onSubmit={vi.fn()} />],
])("%s saved locations first-default flag", (_entity, renderForm) => {
  const render = async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    await act(async () => {
      create(renderForm());
    });
  };

  beforeEach(() => {
    harness.isFirstLocation = undefined;
  });

  it("is false while the list is loading", async () => {
    harness.query = { data: undefined, isLoading: true, isError: false };
    await render();
    expect(harness.isFirstLocation).toBe(false);
  });

  it("is false when the list failed to load", async () => {
    harness.query = { data: undefined, isLoading: false, isError: true };
    await render();
    expect(harness.isFirstLocation).toBe(false);
  });

  it("is true only for a loaded, empty list", async () => {
    harness.query = { data: [], isLoading: false, isError: false };
    await render();
    expect(harness.isFirstLocation).toBe(true);
  });

  it("is false when locations exist", async () => {
    harness.query = { data: [{ id: "x", name: "X", country: "CH", address: null, gpsLatitude: null, gpsLongitude: null, isDefault: true }], isLoading: false, isError: false };
    await render();
    expect(harness.isFirstLocation).toBe(false);
  });
});
