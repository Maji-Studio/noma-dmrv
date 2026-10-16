import { beforeEach, describe, expect, it, vi } from "vitest";
import { DomainError } from "@/lib/domain-errors";
import { ActionConflictError } from "@/lib/errors";
import { conflictCode } from "@/lib/conflict-ref";
import { STALE_VERSION_CONFLICT_CODE, STALE_VERSION_MESSAGE } from "@/lib/stale-version";
const mocks = vi.hoisted(() => ({ write: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ requireOrgContext: async () => ({ organizationId: "org", userId: "user", orgRole: "owner", isPlatformAdmin: false }) }));
vi.mock("@/data-access/code-generator", () => ({ CODE_CONFLICT_MESSAGES: {}, withAutoCode: vi.fn() }));
vi.mock("@/data-access/samples", () => ({ getSampleById: mocks.read }));
// Sample writes run the lab sample operations in process.
vi.mock("@/lib/operations/runner", () => ({ runOperationInProcess: mocks.write }));
vi.mock("@/lib/operations/lab-samples", () => ({ recordLabSample: {}, updateLabSample: {}, deleteLabSample: {} }));
vi.mock("@/data-access/orders", () => ({ updateOrder: mocks.write, deleteOrder: mocks.write }));
vi.mock("@/lib/operations/deliveries", () => ({ updateDelivery: mocks.write }));
vi.mock("@/data-access/deliveries", () => ({ deleteDelivery: mocks.write }));
vi.mock("@/lib/operations/applications", () => ({ recordApplication: {}, updateApplication: {}, deleteApplication: {} }));
vi.mock("@/data-access/credit-batches", () => ({ updateCreditBatch: mocks.write, deleteCreditBatch: mocks.write, getCreditBatchById: mocks.read }));
vi.mock("@/data-access/transport-legs", () => ({ updateTransportLeg: mocks.write, deleteTransportLeg: mocks.write }));
import { updateSampleFn, deleteSampleFn } from "./samples";
import { createOrderFn, updateOrderFn, deleteOrderFn } from "./orders";
import { updateDeliveryFn, deleteDeliveryFn } from "./deliveries";
import { createApplicationFn, updateApplicationFn, deleteApplicationFn } from "./applications";
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
it("preserves the Sample conflict from a refused credit batch delete", async () => {
  const message = "This credit batch has Samples.";
  const conflict = { entity: "sample", id: ID, code: conflictCode("SAM-1") };
  mocks.write.mockRejectedValue(new ActionConflictError(message, conflict));
  expect(await deleteCreditBatchFn({ creditBatchId: ID, expectedVersion: INITIAL_VERSION }))
    .toEqual({ success: false, error: message, code: "conflict", conflict });
});
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

it("refuses order creation without a delivery site before reaching the operation", async () => {
  const result = await createOrderFn({ facilityId: ID, customerId: ID, formulationId: ID,
    orderDate: new Date("2026-09-12T00:00:00Z"), quantityKg: 100, packaging: "loose" } as never);
  expect(result).toMatchObject({ success: false, code: "validation_failed", issues: [{ path: ["customerLocationId"], message: "Select a customer location." }] });
  expect(mocks.write).not.toHaveBeenCalled();
});

it("returns only the saved application row from create and update actions", async () => {
  const application = { id: ID, version: 2 };
  mocks.write.mockResolvedValue({ application, allocations: [], deliveryBalance: {}, warnings: ["Advisory"] });
  expect(await createApplicationFn({ deliveryId: ID, applicationDate: "2026-01-02", appliedWetMassKg: 1, fieldSizeHa: 1, gpsLatitude: 0, gpsLongitude: 0 }))
    .toEqual({ success: true, data: application });
  expect(await updateApplicationFn({ applicationId: ID, expectedVersion: 1 })).toEqual({ success: true, data: application });
});
