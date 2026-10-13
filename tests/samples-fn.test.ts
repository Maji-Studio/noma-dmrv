import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Sample Server Actions validate the form and run the lab sample
 * operations; the batch window, zone, archive and lineage checks moved into
 * the writer (tests/operation-lab-samples.test.ts covers them on a database).
 * These specs pin what the actions pass on and what they return.
 */

const mockRunOperation = vi.fn();
const mockGetSampleById = vi.fn();

vi.mock("@/lib/auth/server", () => ({
  requireOrgContext: vi.fn().mockResolvedValue({
    userId: "user-123",
    organizationId: "org_test_fixtures",
    orgRole: "owner",
    isPlatformAdmin: false,
  }),
}));

vi.mock("@/lib/operations/runner", () => ({
  runOperationInProcess: (...args: unknown[]) => mockRunOperation(...args),
}));

vi.mock("@/lib/operations/lab-samples", () => ({
  recordLabSample: { id: "record_lab_sample" },
  updateLabSample: { id: "update_lab_sample" },
  deleteLabSample: { id: "delete_lab_sample" },
}));

vi.mock("@/data-access/samples", () => ({
  getSampleById: (...args: unknown[]) => mockGetSampleById(...args),
  getSampleStats: vi.fn(),
  getSamples: vi.fn(),
}));

import { DomainError } from "@/lib/domain-errors";
import { createSampleFn, getSampleByIdFn, updateSampleFn } from "@/fn/samples";

const CREDIT_BATCH_ID = "22222222-2222-4222-8222-222222222222";
const LATER_CREDIT_BATCH_ID = "55555555-5555-4555-8555-555555555555";
const SAMPLE_ID = "33333333-3333-4333-8333-333333333333";
const BEFORE_WINDOW_MESSAGE =
  "Sample date 2025-12-31 is before credit batch CB-001's production window, 2026-01-01 to 2026-01-31. Choose a date within or after the production window.";

function baseSampleInput(overrides: Record<string, unknown> = {}) {
  return {
    creditBatchId: CREDIT_BATCH_ID,
    samplingTime: new Date("2026-01-15T12:00:00.000Z"),
    totalCarbonPercent: 80,
    organicCarbonPercent: 75,
    durabilityOption: "200_year" as const,
    nutrientClaimEnabled: false,
    ...overrides,
  };
}

function operationInput(): Record<string, unknown> {
  return mockRunOperation.mock.calls[0][2] as Record<string, unknown>;
}

function windowRefusal() {
  return new DomainError("validation_failed", BEFORE_WINDOW_MESSAGE, {
    issues: [{ path: ["samplingTime"], code: "validation_failed", message: BEFORE_WINDOW_MESSAGE }],
  });
}

beforeEach(() => {
  mockRunOperation.mockReset();
  mockRunOperation.mockResolvedValue({ sample: { id: "sample-1" }, notices: [], warnings: [] });
  mockGetSampleById.mockReset();
});

describe("createSampleFn", () => {
  it("passes the required creditBatchId through to the operation", async () => {
    await createSampleFn(baseSampleInput());

    expect(mockRunOperation).toHaveBeenCalledOnce();
    expect(operationInput().creditBatchId).toBe(CREDIT_BATCH_ID);
  });

  it("passes 1000-year s_fraction through to the operation", async () => {
    await createSampleFn(baseSampleInput({
      durabilityOption: "1000_year",
      randomReflectanceR0Percent: 2.8,
      sReflectanceFraction: 0.92,
      residualCarbonPercent: 65,
    }));
    expect(operationInput().sReflectanceFraction).toBe(0.92);
  });

  it("rejects a sample without a credit batch (issue #309: exactly one batch)", async () => {
    const withoutBatch = { ...baseSampleInput() };
    Reflect.deleteProperty(withoutBatch, "creditBatchId");
    const result = await createSampleFn(
      withoutBatch as Parameters<typeof createSampleFn>[0],
    );

    expect(result.success).toBe(false);
    expect(mockRunOperation).not.toHaveBeenCalled();
  });

  it("shows the writer's before-window refusal unchanged", async () => {
    mockRunOperation.mockRejectedValue(windowRefusal());
    const result = await createSampleFn(
      baseSampleInput({ samplingTime: new Date("2025-12-31T23:59:59.000Z") }),
    );

    expect(result).toMatchObject({ success: false, error: BEFORE_WINDOW_MESSAGE });
  });

  it("returns the saved Sample on success", async () => {
    const result = await createSampleFn(
      baseSampleInput({ samplingTime: new Date("2026-02-15T12:00:00.000Z") }),
    );

    expect(result).toEqual({ success: true, data: { id: "sample-1" } });
  });
});

describe("updateSampleFn", () => {
  it("shows the writer's before-window refusal for an earlier sampling time", async () => {
    mockRunOperation.mockRejectedValue(windowRefusal());
    const result = await updateSampleFn({ expectedVersion: 1,
      sampleId: SAMPLE_ID,
      samplingTime: new Date("2025-12-31T23:59:59.000Z"),
    });

    expect(result).toMatchObject({ success: false, error: BEFORE_WINDOW_MESSAGE });
  });

  it("passes a batch move to the operation, which re-checks the target window", async () => {
    await updateSampleFn({ expectedVersion: 1,
      sampleId: SAMPLE_ID,
      creditBatchId: LATER_CREDIT_BATCH_ID,
    });

    expect(operationInput()).toMatchObject({ labSampleId: SAMPLE_ID, expectedVersion: 1, creditBatchId: LATER_CREDIT_BATCH_ID });
  });

  it("allows moving an assigned sample after its batch window", async () => {
    const result = await updateSampleFn({ expectedVersion: 1,
      sampleId: SAMPLE_ID,
      samplingTime: new Date("2026-02-15T12:00:00.000Z"),
    });

    expect(result.success).toBe(true);
    expect(mockRunOperation).toHaveBeenCalledOnce();
  });
});

describe("getSampleByIdFn", () => {
  it("sanitizes raw database errors into the generic fallback (issue #251)", async () => {
    mockGetSampleById.mockRejectedValue(
      new Error(
        'Failed query: select "samples"."id" from "samples" where "samples"."id" = $1 -- params: ["66666666-6666-4666-8666-666666666666"]',
      ),
    );

    const result = await getSampleByIdFn(
      "66666666-6666-4666-8666-666666666666",
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe(
        "Sample could not be loaded. Refresh the page and try again.",
      );
      expect(result.error).not.toMatch(/select/);
      expect(result.error).not.toMatch(/params:/);
    }
  });
});
