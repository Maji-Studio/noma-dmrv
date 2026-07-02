import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateSample = vi.fn();
const mockWithAutoCode = vi.fn();

vi.mock("@/lib/auth/server", () => ({
  getUser: vi.fn().mockResolvedValue({
    id: "user-123",
    email: "test@example.com",
    name: "Test",
    emailVerified: true,
    role: "admin" as const,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
  }),
}));

vi.mock("@/data-access/samples", () => ({
  createSample: (...args: unknown[]) => mockCreateSample(...args),
  deleteSample: vi.fn(),
  generateNextSampleCode: vi.fn(),
  getSampleById: vi.fn(),
  getSampleStats: vi.fn(),
  getSamples: vi.fn(),
  isSampleCodeAvailable: vi.fn(),
  updateSample: vi.fn(),
}));

vi.mock("@/data-access/code-generator", () => ({
  withAutoCode: (...args: unknown[]) => mockWithAutoCode(...args),
}));

import { createSampleFn } from "@/fn/samples";

const CREDIT_BATCH_ID = "22222222-2222-4222-8222-222222222222";

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

describe("createSampleFn", () => {
  beforeEach(() => {
    mockCreateSample.mockReset();
    mockCreateSample.mockResolvedValue({ id: "sample-1" });
    mockWithAutoCode.mockReset();
    mockWithAutoCode.mockImplementation(
      async (
        _prefix: unknown,
        _table: unknown,
        _column: unknown,
        _excludeId: unknown,
        create: (code: string) => Promise<unknown>,
      ) => create("SAM-001"),
    );
  });

  it("passes the required creditBatchId through to data-access", async () => {
    await createSampleFn(baseSampleInput());

    expect(mockCreateSample).toHaveBeenCalledOnce();
    const payload = mockCreateSample.mock.calls[0][1];
    expect(payload.creditBatchId).toBe(CREDIT_BATCH_ID);
  });

  it("rejects a sample without a credit batch (issue #309: exactly one batch)", async () => {
    const { creditBatchId: _omitted, ...withoutBatch } = baseSampleInput();
    const result = await createSampleFn(
      withoutBatch as Parameters<typeof createSampleFn>[0],
    );

    expect(result.success).toBe(false);
    expect(mockCreateSample).not.toHaveBeenCalled();
  });
});
