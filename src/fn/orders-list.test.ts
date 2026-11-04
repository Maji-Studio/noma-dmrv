import { beforeEach, expect, it, vi } from "vitest";
import { getOrdersFn } from "./orders";
import { MAX_ORDER_LIST_SIZE as MAX_LIST_IDS, orderFilterSchema } from "@/schemas/orders";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn(), facility: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ requireOrgContext: mocks.auth }));
vi.mock("@/data-access/orders", () => ({ getOrders: mocks.list }));
vi.mock("@/data-access/order-stats", () => ({ getOrderStats: vi.fn() }));
vi.mock("@/data-access/utils", () => ({ requireOrgFacility: mocks.facility }));
vi.mock("@/lib/operations/orders", () => ({ recordOrder: vi.fn(), updateOrder: vi.fn(), deleteOrder: vi.fn() }));
vi.mock("@/lib/operations/runner", () => ({ runOperationInProcess: vi.fn() }));
vi.mock("@/lib/log", () => ({ logger: { error: vi.fn() }, sanitizeErrorMessage: () => "error" }));

const ORDER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FACILITY_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ctx = { userId: "user", organizationId: "org", orgRole: "admin", isPlatformAdmin: false };
const page = { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue(ctx);
  mocks.list.mockResolvedValue(page);
});

it("validates and forwards the exact ids within the authenticated facility scope", async () => {
  expect(await getOrdersFn({ ids: [ORDER_ID], facilityId: FACILITY_ID })).toEqual({ success: true, data: page });
  expect(mocks.facility).toHaveBeenCalledExactlyOnceWith(ctx, FACILITY_ID);
  expect(mocks.list).toHaveBeenCalledExactlyOnceWith(ctx, expect.objectContaining({ ids: [ORDER_ID], facilityId: FACILITY_ID }));
});

it.each([
  ["a malformed id", ["not-a-uuid"]],
  ["too many ids", Array.from({ length: MAX_LIST_IDS + 1 }, () => ORDER_ID)],
] as const)("rejects %s before querying orders", async (_label, ids) => {
  expect(await getOrdersFn({ ids: [...ids] })).toMatchObject({ success: false });
  expect(mocks.list).not.toHaveBeenCalled();
});

it("accepts a full exact-id chunk", async () => {
  const ids = Array.from({ length: MAX_LIST_IDS }, () => ORDER_ID);
  expect(await getOrdersFn({ ids })).toMatchObject({ success: true });
  expect(mocks.list).toHaveBeenCalledWith(ctx, expect.objectContaining({ ids }));
});

it("requires authentication before reading the requested ids", async () => {
  mocks.auth.mockRejectedValue(new Error("Authentication required"));
  expect(await getOrdersFn({ ids: [ORDER_ID] })).toMatchObject({ success: false });
  expect(mocks.list).not.toHaveBeenCalled();
});

it("does not query when the requested facility is outside the organization", async () => {
  mocks.facility.mockRejectedValue(new Error("Facility unavailable"));
  expect(await getOrdersFn({ ids: [ORDER_ID], facilityId: FACILITY_ID })).toMatchObject({ success: false });
  expect(mocks.list).not.toHaveBeenCalled();
});

it("validates exact ids and the named page-size boundary in the list schema", () => {
  expect(orderFilterSchema.parse({ ids: [ORDER_ID], pageSize: MAX_LIST_IDS }).ids).toEqual([ORDER_ID]);
  expect(orderFilterSchema.safeParse({ ids: ["not-a-uuid"] }).success).toBe(false);
  expect(orderFilterSchema.safeParse({ ids: Array(MAX_LIST_IDS + 1).fill(ORDER_ID) }).success).toBe(false);
  expect(orderFilterSchema.safeParse({ pageSize: MAX_LIST_IDS + 1 }).success).toBe(false);
});
