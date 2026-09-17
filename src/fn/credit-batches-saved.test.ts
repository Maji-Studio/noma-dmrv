/**
 * Saving a credit batch and reading its accounting roll-up are two outcomes,
 * not one (issues #769, #797). The write commits first; the roll-up read runs
 * after that commit and can fail on its own, and when it does the action still
 * reports the batch as saved and says only that its details did not load.
 * The data-access layer is mocked here; the committed-write contract itself is
 * exercised against a real database in tests/credit-batch-saved-outcome.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOrgContext: vi.fn(),
  createCreditBatch: vi.fn(),
  updateCreditBatch: vi.fn(),
  getCreditBatchById: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("@/db", () => ({ db: {} }));

vi.mock("@/lib/auth/server", () => ({
  requireOrgContext: mocks.requireOrgContext,
}));

vi.mock("@/data-access/utils", () => ({ requireOrgFacility: vi.fn() }));

vi.mock("@/data-access/code-generator", () => ({
  withAutoCode: (
    _ctx: unknown,
    _prefix: string,
    _table: unknown,
    _column: unknown,
    _scope: unknown,
    run: (code: string) => unknown,
  ) => run("CB-001"),
}));

vi.mock("@/data-access/credit-batches", () => ({
  createCreditBatch: mocks.createCreditBatch,
  getCreditBatchById: mocks.getCreditBatchById,
  getCo2eStoredPreviews: vi.fn(),
  getCreditBatchProductionRunOptions: vi.fn(),
  updateCreditBatch: mocks.updateCreditBatch,
  deleteCreditBatch: vi.fn(),
  creditBatchCodeExists: vi.fn(),
}));

vi.mock("@/lib/log", () => ({
  logger: { error: mocks.loggerError, child: () => ({ error: mocks.loggerError }) },
  sanitizeErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));

import { createCreditBatchFn, updateCreditBatchFn } from "./credit-batches";
import { SAVED_DETAILS_UNAVAILABLE } from "@/lib/copy-utils";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const FACILITY_ID = "00000000-0000-4000-8000-000000000002";
const FEEDSTOCK_TYPE_ID = "00000000-0000-4000-8000-000000000003";
const BATCH_ID = "00000000-0000-4000-8000-000000000004";

const input = {
  facilityId: FACILITY_ID,
  feedstockTypeId: FEEDSTOCK_TYPE_ID,
  startDate: new Date("2026-01-01T00:00:00.000Z"),
  endDate: new Date("2026-01-31T00:00:00.000Z"),
  sampling: "sampled" as const,
  productionRunIds: [],
  currency: "TZS" as const,
};

/** The committed row, as the data-access layer answers it. */
function createdRow(rollupLoaded: boolean) {
  return {
    id: BATCH_ID,
    code: "CB-001",
    facilityId: FACILITY_ID,
    appliedWeightTons: rollupLoaded ? 12.5 : null,
    applicationIds: rollupLoaded ? [FACILITY_ID] : null,
    applicationCount: rollupLoaded ? 1 : null,
    previewAvailable: rollupLoaded,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireOrgContext.mockResolvedValue({ organizationId: ORGANIZATION_ID });
});

describe("createCreditBatchFn", () => {
  it("reports a plain success when the roll-up loads with the batch", async () => {
    mocks.createCreditBatch.mockResolvedValue(createdRow(true));

    const result = await createCreditBatchFn(input);

    expect(result.success).toBe(true);
    expect(result).not.toHaveProperty("warning");
    expect(result.success && result.data.appliedWeightTons).toBe(12.5);
  });

  it("still reports the batch as saved when the post-commit roll-up does not load", async () => {
    mocks.createCreditBatch.mockResolvedValue(createdRow(false));

    const result = await createCreditBatchFn(input);

    expect(result).toMatchObject({
      success: true,
      warning: SAVED_DETAILS_UNAVAILABLE,
    });
    // The batch is durable; only its roll-up is unknown, and unknown is never
    // reported as zero.
    expect(result.success && result.data.id).toBe(BATCH_ID);
    expect(result.success && result.data.appliedWeightTons).toBeNull();
    expect(result.success && result.data.applicationIds).toBeNull();
  });

  it("reports a failed write as a failure, never as a warning", async () => {
    mocks.createCreditBatch.mockRejectedValue(new Error("insert failed"));

    const result = await createCreditBatchFn(input);

    expect(result.success).toBe(false);
    expect(result).not.toHaveProperty("warning");
  });
});

describe("updateCreditBatchFn", () => {
  const updateInput = { creditBatchId: BATCH_ID, hToCorgRatio: 0.5 };

  beforeEach(() => {
    mocks.getCreditBatchById.mockResolvedValue({ id: BATCH_ID, code: "CB-001" });
  });

  it("reports a plain success when the roll-up loads with the batch", async () => {
    mocks.updateCreditBatch.mockResolvedValue(createdRow(true));

    const result = await updateCreditBatchFn(updateInput);

    expect(result.success).toBe(true);
    expect(result).not.toHaveProperty("warning");
  });

  it("still reports the batch as saved when the post-commit roll-up does not load", async () => {
    mocks.updateCreditBatch.mockResolvedValue(createdRow(false));

    const result = await updateCreditBatchFn(updateInput);

    expect(result).toMatchObject({
      success: true,
      warning: SAVED_DETAILS_UNAVAILABLE,
    });
    expect(result.success && result.data.appliedWeightTons).toBeNull();
  });

  it("reports a failed write as a failure, never as a warning", async () => {
    mocks.updateCreditBatch.mockRejectedValue(new Error("update failed"));

    const result = await updateCreditBatchFn(updateInput);

    expect(result.success).toBe(false);
    expect(result).not.toHaveProperty("warning");
  });
});
