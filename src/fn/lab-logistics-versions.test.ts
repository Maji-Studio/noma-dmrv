import { beforeEach, describe, expect, it, vi } from "vitest";
import { DomainError } from "@/lib/domain-errors";
import { STALE_VERSION_CONFLICT_CODE, STALE_VERSION_MESSAGE } from "@/lib/stale-version";
const mocks = vi.hoisted(() => ({ write: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ requireOrgContext: async () => ({ organizationId: "org", userId: "user", orgRole: "owner", isPlatformAdmin: false }) }));
vi.mock("@/data-access/code-generator", () => ({ CODE_CONFLICT_MESSAGES: {}, withAutoCode: vi.fn() }));
vi.mock("@/data-access/samples", () => ({ updateSample: mocks.write, deleteSample: mocks.write, getSampleById: mocks.read }));
vi.mock("@/data-access/orders", () => ({ updateOrder: mocks.write, deleteOrder: mocks.write }));
vi.mock("@/data-access/deliveries", () => ({ updateDelivery: mocks.write, deleteDelivery: mocks.write }));
vi.mock("@/data-access/applications", () => ({ updateApplication: mocks.write, deleteApplication: mocks.write, getApplicationById: mocks.read }));
vi.mock("@/data-access/credit-batches", () => ({ updateCreditBatch: mocks.write, deleteCreditBatch: mocks.write, getCreditBatchById: mocks.read }));
vi.mock("@/data-access/transport-legs", () => ({ updateTransportLeg: mocks.write, deleteTransportLeg: mocks.write }));
import { updateSampleFn, deleteSampleFn } from "./samples";
import { updateOrderFn, deleteOrderFn } from "./orders";
import { updateDeliveryFn, deleteDeliveryFn } from "./deliveries";
import { updateApplicationFn, deleteApplicationFn } from "./applications";
import { updateCreditBatchFn, deleteCreditBatchFn } from "./credit-batches";
import { updateTransportLegFn, deleteTransportLegFn } from "./transport-legs";
const ID = "33333333-3333-4333-8333-333333333333";
const INITIAL_VERSION = 1;
const cases = [
  { entity: "sample", update: updateSampleFn, remove: deleteSampleFn, identity: { sampleId: ID }, fields: {} },
  { entity: "order", update: updateOrderFn, remove: deleteOrderFn, identity: { orderId: ID }, fields: {} },
  { entity: "delivery", update: updateDeliveryFn, remove: deleteDeliveryFn, identity: { deliveryId: ID }, fields: {} },
  { entity: "application", update: updateApplicationFn, remove: deleteApplicationFn, identity: { applicationId: ID }, fields: {} },
  { entity: "creditBatch", update: updateCreditBatchFn, remove: deleteCreditBatchFn, identity: { creditBatchId: ID }, fields: {} },
  { entity: "transportLeg", update: updateTransportLegFn, remove: deleteTransportLegFn, identity: { id: ID }, fields: { distanceKm: 10, loadMassKg: 1 } },
];
beforeEach(() => { mocks.write.mockReset(); mocks.read.mockResolvedValue({ id: ID, code: "CODE" }); });
describe.each(cases)("$entity action versions", entry => {
  it("preserves the stale code and conflict from updates and deletes", async () => {
    const conflict = { entity: entry.entity, id: ID, code: STALE_VERSION_CONFLICT_CODE };
    mocks.write.mockRejectedValue(new DomainError("stale_version", STALE_VERSION_MESSAGE, { conflict }));
    const input = { ...entry.identity, ...entry.fields, expectedVersion: INITIAL_VERSION };
    for (const action of [entry.update, entry.remove]) {
      expect(await action(input as never)).toEqual({ success: false, error: STALE_VERSION_MESSAGE, code: "stale_version", conflict });
    }
  });
  it("requires a precondition before reaching either writer", async () => {
    for (const action of [entry.update, entry.remove]) {
      expect(await action({ ...entry.identity, ...entry.fields } as never)).toMatchObject({ success: false, code: "validation_failed" });
    }
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
