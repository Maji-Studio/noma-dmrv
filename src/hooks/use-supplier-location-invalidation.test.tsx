// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { useCreateSupplierLocation, useUpdateSupplierLocation } from "./use-suppliers";
import { transportLegKeys } from "./use-transport-legs";
import { feedstockKeys } from "./use-feedstocks";
import { certificationKeys } from "./use-certification";
import { creditBatchKeys } from "./credit-batch-query-keys";

vi.mock("@/fn/suppliers", () => ({
  createSupplierLocationFn: vi.fn(async () => ({ success: true, data: { id: "location", version: 2 } })),
  updateSupplierLocationFn: vi.fn(async () => ({ success: true, data: { id: "location", version: 2 } })),
}));

it.each(["create", "update"] as const)("refreshes transport and readiness before the %s callback", async operation => {
  const client = new QueryClient();
  const keys = [transportLegKeys.all, feedstockKeys.all, certificationKeys.all,
    creditBatchKeys.previewsPrefix(), creditBatchKeys.details()];
  for (const key of keys) client.setQueryData(key, []);
  const onSuccess = vi.fn(() => {
    for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  });
  const view = renderHook(() => ({
    create: useCreateSupplierLocation({ onSuccess }),
    update: useUpdateSupplierLocation("supplier", { onSuccess }),
  }), { wrapper: ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}>{children}</QueryClientProvider> });
  await act(async () => {
    if (operation === "create") await view.result.current.create.mutateAsync({
      supplierId: "supplier", country: "CH", gpsLatitude: 47, gpsLongitude: 8, isDefault: true,
    });
    else await view.result.current.update.mutateAsync({ locationId: "location", expectedVersion: 1, isDefault: true });
  });
  expect(onSuccess).toHaveBeenCalledOnce();
  view.unmount();
  client.clear();
});
