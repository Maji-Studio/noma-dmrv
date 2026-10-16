import { beforeEach, expect, it, vi } from "vitest";
import { getTransportDistanceDriftFn, refreshFeedstockDistanceFn, refreshDeliveryDistanceFn } from "./transport-distance-refresh";
import { STALE_VERSION_MESSAGE } from "@/lib/stale-version";
import { DomainError } from "@/lib/domain-errors";

const mocks = vi.hoisted(() => ({ read: vi.fn(), feedstock: vi.fn(), delivery: vi.fn() }));
vi.mock("@/data-access/transport-distance-drift", () => ({ getTransportDistanceDrift: mocks.read }));
vi.mock("@/data-access/transport-distance-refresh", () => ({ refreshFeedstockDistanceInTransaction: mocks.feedstock, refreshDeliveryDistanceInTransaction: mocks.delivery }));
vi.mock("@/lib/auth/server", () => ({ requireOrgContext: async () => ({ organizationId: "session-org", userId: "actor", orgRole: "owner", isPlatformAdmin: false }) }));
vi.mock("@/lib/operations/runner", () => ({ runOperationInProcess: async (op: { execute: (scope: unknown, input: unknown) => unknown }, ctx: unknown, input: unknown) => op.execute({ ctx }, input) }));
const ID = "00000000-0000-4000-8000-000000000001";
beforeEach(() => { vi.clearAllMocks(); });

it.each([refreshFeedstockDistanceFn, refreshDeliveryDistanceFn])("refuses refresh without an expected version", async refresh => {
  expect(await refresh({ entityId: ID } as never)).toMatchObject({ success: false, code: "validation_failed" });
  expect(mocks.feedstock).not.toHaveBeenCalled();
  expect(mocks.delivery).not.toHaveBeenCalled();
});
it("validates reads and scopes them from the session", async () => {
  expect(await getTransportDistanceDriftFn({ entityType: "delivery", entityId: "invalid" })).toMatchObject({ success: false });
  expect(mocks.read).not.toHaveBeenCalled();
  mocks.read.mockResolvedValue({ hasDrift: true });
  expect(await getTransportDistanceDriftFn({ entityType: "feedstock", entityId: ID })).toEqual({ success: true, data: { hasDrift: true } });
  expect(mocks.read).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "session-org" }), { entityType: "feedstock", entityId: ID });
});
it("preserves stale-version failures for refresh forms", async () => {
  mocks.delivery.mockRejectedValue(new DomainError("stale_version", STALE_VERSION_MESSAGE));
  expect(await refreshDeliveryDistanceFn({ entityId: ID, expectedVersion: 1 })).toMatchObject({ success: false, code: "stale_version", error: STALE_VERSION_MESSAGE });
});
