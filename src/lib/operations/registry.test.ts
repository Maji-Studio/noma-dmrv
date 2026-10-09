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

import { operationRegistry } from "./registry";

const FEEDSTOCK_ID = "11111111-1111-4111-8111-111111111111";
const INITIAL_VERSION = 1;
const UPDATE_INPUTS: Record<string, unknown> = {
  update_production_run: { productionRunId: FEEDSTOCK_ID, expectedVersion: INITIAL_VERSION },
  update_feedstock: { feedstockId: FEEDSTOCK_ID, expectedVersion: INITIAL_VERSION },
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
