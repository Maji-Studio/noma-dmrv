import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateSample = vi.fn();
const mockUpdateSample = vi.fn();
const mockGetSampleById = vi.fn();
const mockWithAutoCode = vi.fn();
const mockGetCreditBatchById = vi.fn();
const mockGetFacilityById = vi.fn();

vi.mock("@/lib/auth/server", () => ({
  requireOrgContext: vi.fn().mockResolvedValue({
    userId: "user-123",
    organizationId: "org_test_fixtures",
    orgRole: "owner",
    isPlatformAdmin: false,
  }),
}));

vi.mock("@/data-access/samples", () => ({
  createSample: (...args: unknown[]) => mockCreateSample(...args),
  deleteSample: vi.fn(),
  generateNextSampleCode: vi.fn(),
  getSampleById: (...args: unknown[]) => mockGetSampleById(...args),
  getSampleStats: vi.fn(),
  getSamples: vi.fn(),
  isSampleCodeAvailable: vi.fn(),
  updateSample: (...args: unknown[]) => mockUpdateSample(...args),
}));

vi.mock("@/data-access/code-generator", () => ({
  withAutoCode: (...args: unknown[]) => mockWithAutoCode(...args),
}));

vi.mock("@/data-access/credit-batches", () => ({
  getCreditBatchById: (...args: unknown[]) => mockGetCreditBatchById(...args),
}));

vi.mock("@/data-access/facilities", () => ({
  getFacilityById: (...args: unknown[]) => mockGetFacilityById(...args),
}));

import { createSampleFn, getSampleByIdFn, updateSampleFn } from "@/fn/samples";

const CREDIT_BATCH_ID = "22222222-2222-4222-8222-222222222222";
const FACILITY_ID = "44444444-4444-4444-8444-444444444444";

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
    mockGetCreditBatchById.mockReset();
    mockGetCreditBatchById.mockResolvedValue({
      code: "CB-001",
      facilityId: FACILITY_ID,
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    });
    mockGetFacilityById.mockReset();
    mockGetFacilityById.mockResolvedValue({
      id: FACILITY_ID,
      timezone: "UTC",
    });
    mockWithAutoCode.mockImplementation(
      async (
        _ctx: unknown,
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

  it("passes 1000-year s_fraction through to data-access", async () => {
    await createSampleFn(baseSampleInput({
      durabilityOption:"1000_year",
      randomReflectanceR0Percent:2.8,
      sReflectanceFraction:0.92,
      residualCarbonPercent:65,
    }));
    expect(mockCreateSample.mock.calls[0][1].sReflectanceFraction).toBe(0.92);
  });

  it("rejects a sample without a credit batch (issue #309: exactly one batch)", async () => {
    const withoutBatch = { ...baseSampleInput() };
    Reflect.deleteProperty(withoutBatch, "creditBatchId");
    const result = await createSampleFn(
      withoutBatch as Parameters<typeof createSampleFn>[0],
    );

    expect(result.success).toBe(false);
    expect(mockCreateSample).not.toHaveBeenCalled();
  });

  it("rejects a sample dated before the assigned credit-batch window", async () => {
    const result = await createSampleFn(
      baseSampleInput({ samplingTime: new Date("2025-12-31T23:59:59.000Z") }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("2026-01-01–2026-01-31");
    }
    expect(mockCreateSample).not.toHaveBeenCalled();
  });

  it("accepts post-window sampling from stored material", async () => {
    const result = await createSampleFn(
      baseSampleInput({ samplingTime: new Date("2026-02-15T12:00:00.000Z") }),
    );

    expect(result.success).toBe(true);
    expect(mockCreateSample).toHaveBeenCalledOnce();
  });
});

describe("updateSampleFn", () => {
  beforeEach(() => {
    mockUpdateSample.mockReset();
    mockUpdateSample.mockResolvedValue({ id: "sample-1" });
    mockGetSampleById.mockReset();
    mockGetSampleById.mockResolvedValue({
      id: "sample-1",
      creditBatchId: CREDIT_BATCH_ID,
      samplingTime: new Date("2026-01-15T12:00:00.000Z"),
    });
    mockGetCreditBatchById.mockReset();
    mockGetCreditBatchById.mockResolvedValue({
      code: "CB-001",
      facilityId: FACILITY_ID,
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    });
    mockGetFacilityById.mockReset();
    mockGetFacilityById.mockResolvedValue({
      id: FACILITY_ID,
      timezone: "UTC",
    });
  });

  it("rejects moving an assigned sample before its batch window", async () => {
    const result = await updateSampleFn({
      sampleId: "33333333-3333-4333-8333-333333333333",
      samplingTime: new Date("2025-12-31T23:59:59.000Z"),
    });

    expect(result.success).toBe(false);
    expect(mockUpdateSample).not.toHaveBeenCalled();
  });

  it("allows moving an assigned sample after its batch window", async () => {
    const result = await updateSampleFn({
      sampleId: "33333333-3333-4333-8333-333333333333",
      samplingTime: new Date("2026-02-15T12:00:00.000Z"),
    });

    expect(result.success).toBe(true);
    expect(mockUpdateSample).toHaveBeenCalledOnce();
  });
});

describe("getSampleByIdFn", () => {
  beforeEach(() => {
    mockGetSampleById.mockReset();
  });

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
      expect(result.error).toBe("Failed to load sample");
      expect(result.error).not.toMatch(/select/);
      expect(result.error).not.toMatch(/params:/);
    }
  });
});
