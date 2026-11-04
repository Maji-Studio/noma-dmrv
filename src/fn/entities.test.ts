import { beforeEach, expect, it, vi } from "vitest";
import { searchEntitiesFn } from "./entities";
import type { OrgContext } from "@/lib/auth/server";

const mocks = vi.hoisted(() => ({ context: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ requireOrgContext: mocks.context }));
vi.mock("@/data-access/entities", () => ({ getEntities: mocks.read, getEntityById: vi.fn() }));
vi.mock("@/data-access/utils", () => ({ requireOrgFacility: vi.fn() }));
vi.mock("@/lib/log", () => ({ logger: { error: vi.fn() }, sanitizeErrorMessage: () => "error" }));

const ctx: OrgContext = { userId: "user", organizationId: "org", orgRole: "member", isPlatformAdmin: false };
const customerId = "ABCDEFAB-1234-4123-8123-ABCDEFABCDEF";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue(ctx);
  mocks.read.mockResolvedValue([]);
});

it("normalizes an uppercase customer filter before passing it to the scoped read", async () => {
  const input = { entityType: "customerLocation", filterBy: { customerId } };
  expect(await searchEntitiesFn(input)).toEqual({ success: true, data: [] });
  expect(mocks.read).toHaveBeenCalledWith(ctx, { ...input, filterBy: { customerId: customerId.toLowerCase() } });
  expect(input.filterBy.customerId).toBe(customerId);
});

it.each(["", "invalid"])("rejects an invalid customer filter (%s) with the existing message", async (customerId) => {
  expect(await searchEntitiesFn({ entityType: "customerLocation", filterBy: { customerId } })).toMatchObject({
    success: false,
    error: expect.stringContaining("The customer filter is invalid. Select a customer and try again."),
  });
  expect(mocks.read).not.toHaveBeenCalled();
});

it("preserves validate-only sibling filters when normalizing the customer id", async () => {
  const input = {
    entityType: "customerLocation",
    filterBy: { customerId, facilityId: customerId, excludeOrderId: customerId, type: "product_bin" },
  };
  expect(await searchEntitiesFn(input)).toEqual({ success: true, data: [] });
  expect(mocks.read).toHaveBeenCalledWith(ctx, {
    ...input,
    filterBy: { ...input.filterBy, customerId: customerId.toLowerCase() },
  });
  expect(input.filterBy.customerId).toBe(customerId);
});

it('validates and forwards the ingredient draw estimate parameters on the existing entity read', async () => {
  const { getEntityByIdFn } = await import('./entities');
  const { getEntityById } = await import('@/data-access/entities');
  vi.mocked(getEntityById).mockResolvedValue(null);
  const filter = { occurredAt: '2026-01-01T12:00:00Z', drawWetKg: '30', excludeProductId: customerId };
  expect(await getEntityByIdFn('storageLocation', customerId, filter)).toEqual({ success: true, data: null });
  expect(getEntityById).toHaveBeenCalledWith(ctx, 'storageLocation', customerId, { ...filter, drawWetKg: 30 });
});
it.each(['0', '-1', 'NaN', 'Infinity', ''])('rejects an invalid ingredient mass %s before reading', async drawWetKg => {
  const { getEntityByIdFn } = await import('./entities');
  const { getEntityById } = await import('@/data-access/entities');
  expect(await getEntityByIdFn('storageLocation', customerId, { drawWetKg })).toMatchObject({ success: false });
  expect(getEntityById).not.toHaveBeenCalled();
});
