import { beforeEach, expect, it, vi } from "vitest";
import { getDeliveriesFn } from "./deliveries";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn(), facility: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ requireOrgContext: mocks.auth }));
vi.mock("@/data-access/deliveries", () => ({ getDeliveries: mocks.list }));
vi.mock("@/data-access/delivery-stats", () => ({ getDeliveryStats: vi.fn() }));
vi.mock("@/data-access/utils", () => ({ requireOrgFacility: mocks.facility }));
vi.mock("@/lib/operations/deliveries", () => ({ recordDeliveryForUi: vi.fn(), updateDelivery: vi.fn(), deletePostedDelivery: vi.fn() }));
vi.mock("@/lib/operations/runner", () => ({ runOperationInProcess: vi.fn() }));
vi.mock("@/lib/log", () => ({ logger: { error: vi.fn() }, sanitizeErrorMessage: () => "error" }));

const DELIVERY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FACILITY_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MAX_LIST_IDS = 100;
const ctx = { userId: "user", organizationId: "org", orgRole: "admin", isPlatformAdmin: false };
const page = { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue(ctx);
  mocks.list.mockResolvedValue(page);
});

it("validates and forwards the exact ids within the authenticated facility scope", async () => {
  expect(await getDeliveriesFn({ ids: [DELIVERY_ID], facilityId: FACILITY_ID })).toEqual({ success: true, data: page });
  expect(mocks.facility).toHaveBeenCalledExactlyOnceWith(ctx, FACILITY_ID);
  expect(mocks.list).toHaveBeenCalledExactlyOnceWith(ctx, expect.objectContaining({ ids: [DELIVERY_ID], facilityId: FACILITY_ID }));
});

it.each([
  ["a malformed id", ["not-a-uuid"]],
  ["too many ids", Array.from({ length: MAX_LIST_IDS + 1 }, () => DELIVERY_ID)],
] as const)("rejects %s before querying deliveries", async (_label, ids) => {
  expect(await getDeliveriesFn({ ids: [...ids] })).toMatchObject({ success: false });
  expect(mocks.list).not.toHaveBeenCalled();
});

it("accepts a full exact-id chunk", async () => {
  const ids = Array.from({ length: MAX_LIST_IDS }, () => DELIVERY_ID);
  expect(await getDeliveriesFn({ ids })).toMatchObject({ success: true });
  expect(mocks.list).toHaveBeenCalledWith(ctx, expect.objectContaining({ ids }));
});

it("requires authentication before reading the requested ids", async () => {
  mocks.auth.mockRejectedValue(new Error("Authentication required"));
  expect(await getDeliveriesFn({ ids: [DELIVERY_ID] })).toMatchObject({ success: false });
  expect(mocks.list).not.toHaveBeenCalled();
});

it("does not query when the requested facility is outside the organization", async () => {
  mocks.facility.mockRejectedValue(new Error("Facility unavailable"));
  expect(await getDeliveriesFn({ ids: [DELIVERY_ID], facilityId: FACILITY_ID })).toMatchObject({ success: false });
  expect(mocks.list).not.toHaveBeenCalled();
});
