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

const PRODUCTION_RUN_ID = "11111111-1111-4111-8111-111111111111";
const CREDIT_BATCH_ID = "22222222-2222-4222-8222-222222222222";

function baseSampleInput(overrides: Record<string, unknown> = {}) {
  return {
    productionRunId: PRODUCTION_RUN_ID,
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

  it("preserves omitted creditBatchId as undefined so data-access can derive it", async () => {
    await createSampleFn(baseSampleInput());

    expect(mockCreateSample).toHaveBeenCalledOnce();
    const payload = mockCreateSample.mock.calls[0][1];
    expect(payload).toMatchObject({ productionRunId: PRODUCTION_RUN_ID });
    expect(payload.creditBatchId).toBeUndefined();
  });

  it("passes explicit creditBatchId through unchanged", async () => {
    await createSampleFn(baseSampleInput({ creditBatchId: CREDIT_BATCH_ID }));

    expect(mockCreateSample).toHaveBeenCalledOnce();
    const payload = mockCreateSample.mock.calls[0][1];
    expect(payload.creditBatchId).toBe(CREDIT_BATCH_ID);
  });
});
