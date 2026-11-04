import { beforeEach, expect, it, vi } from "vitest";
import { getFeedstocksFn } from "./feedstocks";
import { MAX_FEEDSTOCK_LIST_SIZE as MAX_LIST_IDS, feedstockFilterSchema, feedstockStatsFilterSchema } from "@/schemas/feedstocks";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn(), facility: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ requireOrgContext: mocks.auth }));
vi.mock("@/data-access/feedstocks", () => ({ getFeedstocks: mocks.list }));
vi.mock("@/data-access/utils", () => ({ requireOrgFacility: mocks.facility }));
vi.mock("@/lib/operations/feedstocks", () => ({ logFeedstockDelivery: vi.fn(), updateFeedstock: vi.fn(), deleteFeedstock: vi.fn() }));
vi.mock("@/lib/operations/runner", () => ({ runOperationInProcess: vi.fn() }));
vi.mock("@/lib/log", () => ({ logger: { error: vi.fn() }, sanitizeErrorMessage: () => "error" }));

const FEEDSTOCK_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FACILITY_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ctx = { userId: "user", organizationId: "org", orgRole: "admin", isPlatformAdmin: false };
const page = { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue(ctx);
  mocks.list.mockResolvedValue(page);
});

it("validates and forwards the exact ids within the authenticated facility scope", async () => {
  expect(await getFeedstocksFn({ ids: [FEEDSTOCK_ID], facilityId: FACILITY_ID })).toEqual({ success: true, data: page });
  expect(mocks.facility).toHaveBeenCalledExactlyOnceWith(ctx, FACILITY_ID);
  expect(mocks.list).toHaveBeenCalledExactlyOnceWith(ctx, expect.objectContaining({ ids: [FEEDSTOCK_ID], facilityId: FACILITY_ID }));
});

it.each([
  ["a malformed id", ["not-a-uuid"]],
  ["too many ids", Array.from({ length: MAX_LIST_IDS + 1 }, () => FEEDSTOCK_ID)],
] as const)("rejects %s before querying feedstocks", async (_label, ids) => {
  expect(await getFeedstocksFn({ ids: [...ids] })).toMatchObject({ success: false });
  expect(mocks.list).not.toHaveBeenCalled();
});

it("accepts a full exact-id chunk", async () => {
  const ids = Array.from({ length: MAX_LIST_IDS }, () => FEEDSTOCK_ID);
  expect(await getFeedstocksFn({ ids })).toMatchObject({ success: true });
  expect(mocks.list).toHaveBeenCalledWith(ctx, expect.objectContaining({ ids }));
});

it("requires authentication before reading the requested ids", async () => {
  mocks.auth.mockRejectedValue(new Error("Authentication required"));
  expect(await getFeedstocksFn({ ids: [FEEDSTOCK_ID] })).toMatchObject({ success: false });
  expect(mocks.list).not.toHaveBeenCalled();
});

it("does not query when the requested facility is outside the organization", async () => {
  mocks.facility.mockRejectedValue(new Error("Facility unavailable"));
  expect(await getFeedstocksFn({ ids: [FEEDSTOCK_ID], facilityId: FACILITY_ID })).toMatchObject({ success: false });
  expect(mocks.list).not.toHaveBeenCalled();
});

it("validates exact ids and the named page-size boundary in the list schema", () => {
  expect(feedstockFilterSchema.parse({ ids: [FEEDSTOCK_ID], pageSize: MAX_LIST_IDS }).ids).toEqual([FEEDSTOCK_ID]);
  expect(feedstockFilterSchema.safeParse({ ids: ["not-a-uuid"] }).success).toBe(false);
  expect(feedstockFilterSchema.safeParse({ ids: Array(MAX_LIST_IDS + 1).fill(FEEDSTOCK_ID) }).success).toBe(false);
  expect(feedstockFilterSchema.safeParse({ pageSize: MAX_LIST_IDS + 1 }).success).toBe(false);
});

it("keeps exact ids out of feedstock stats filters", () => {
  expect(feedstockStatsFilterSchema.parse({ facilityId: FACILITY_ID, ids: [FEEDSTOCK_ID] }))
    .toEqual({ facilityId: FACILITY_ID });
});
