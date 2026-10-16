import { describe, expect, it, vi } from "vitest";

// This contract only parses schemas; operation execution never reaches the DB.
vi.mock("@/data-access/production-runs", () => ({
  createProductionRunInTransaction: vi.fn(), updateProductionRunInTransaction: vi.fn(), deleteProductionRunInTransaction: vi.fn(),
}));
vi.mock("@/data-access/code-generator", () => ({ withAutoCodes: vi.fn(), CODE_CONFLICT_MESSAGES: {} }));
vi.mock("@/data-access/feedstocks", () => ({
  createFeedstockInTransaction: vi.fn(),
  updateFeedstockInTransaction: vi.fn(),
  deleteFeedstockInTransaction: vi.fn(),
}));
vi.mock("@/data-access/storage-object-deletions", () => ({
  processPendingStorageObjectDeletions: vi.fn(),
}));

import { getOperation, operationRegistry } from "./registry";
import { recordDeliveryForUi } from "./deliveries";

const FEEDSTOCK_ID = "11111111-1111-4111-8111-111111111111";
const INITIAL_VERSION = 1;
const UPDATE_INPUTS: Record<string, unknown> = {
  update_application: { applicationId: FEEDSTOCK_ID, expectedVersion: INITIAL_VERSION },
  update_delivery: { deliveryId: FEEDSTOCK_ID, expectedVersion: INITIAL_VERSION },
  update_order: { orderId: FEEDSTOCK_ID, expectedVersion: INITIAL_VERSION },
  update_production_run: { productionRunId: FEEDSTOCK_ID, expectedVersion: INITIAL_VERSION },
  update_feedstock: { feedstockId: FEEDSTOCK_ID, expectedVersion: INITIAL_VERSION },
  update_biochar_product: { biocharProductId: FEEDSTOCK_ID, expectedVersion: INITIAL_VERSION },
  update_lab_sample: { labSampleId: FEEDSTOCK_ID, expectedVersion: INITIAL_VERSION },
};

describe.each(Object.entries(operationRegistry))("registry operation %s", (key, operation) => {
  it("uses its registry key as its id", () => {
    expect(operation.id).toBe(key);
  });

  if (key.startsWith("update_")) {
    it("keeps every omitted optional input undefined after parsing", () => {
      // New updates need a minimal valid input fixture, never execution mocks.
      expect(UPDATE_INPUTS[key]).toBeDefined();
      const parsed: Record<string, unknown> = operation.input.parse(UPDATE_INPUTS[key]);
      for (const [field, schema] of Object.entries(operation.input.shape)) {
        if (schema.isOptional()) {
          expect(UPDATE_INPUTS[key]).not.toHaveProperty(field);
          expect(parsed[field], `${key}.${field}`).toBeUndefined();
        }
      }
    });
  }
});

it("publishes delivery create and metadata PATCH, keeping corrections and custom create fields private", () => {
  const record = getOperation("record_delivery");
  const update = getOperation("update_delivery");
  expect(record?.supportsDryRun).toBe(true);
  expect(update?.supportsDryRun).toBe(true);
  expect(recordDeliveryForUi.id).toBe("record_posted_delivery");
  expect(getOperation(recordDeliveryForUi.id)).toBeUndefined();
  expect(getOperation("update_posted_delivery")).toBeUndefined();
  expect(getOperation("delete_delivery")).toBeUndefined();
  const input = { orderId: FEEDSTOCK_ID, storageLocationId: FEEDSTOCK_ID, deliveredAt: "2026-09-14T12:00:00Z", deliveredWetMassKg: 100, moisturePercent: 20 };
  expect(record?.input.safeParse(input).success).toBe(true);
  for (const field of ["idempotencyKey", "code"]) expect(record?.input.safeParse({ ...input, [field]: "custom" }).success).toBe(false);
  for (const field of ["deliveredWetMassKg", "moisturePercent", "sources", "deliveredAt", "orderId", "storageLocationId", "idempotencyKey", "correctsMovementId"]) {
    expect(update?.input.safeParse({ deliveryId: FEEDSTOCK_ID, expectedVersion: INITIAL_VERSION, [field]: null }).success).toBe(false);
  }
});

it("publishes only document upload requests, keeping confirm facts, renewal and app mutations private", () => {
  const operation = getOperation("request_document_upload");
  expect(operation?.supportsDryRun).toBe(false);
  expect(operation?.input.safeParse({ ownerType: "feedstock", ownerId: FEEDSTOCK_ID, documentType: "bill_of_lading", fileName: "receipt.pdf", contentType: "application/pdf", sizeBytes: 8, sha256: "a".repeat(64) }).success).toBe(true);
  for (const id of ["confirm_document_upload", "renew_document_upload", "delete_document", "request_document_upload_app", "confirm_document_upload_app", "delete_document_app"]) expect(getOperation(id)).toBeUndefined();
});

it("registers application writes with dry run support", () => {
  for (const id of ["record_application", "update_application", "delete_application"]) {
    expect(getOperation(id)?.supportsDryRun).toBe(true);
  }
});
