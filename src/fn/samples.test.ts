import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateSampleFn } from "./samples";

const mocks = vi.hoisted(() => ({
  getCreditBatchById: vi.fn(),
  getFacilityById: vi.fn(),
  getSampleById: vi.fn(),
  requireOrgContext: vi.fn(),
  updateSample: vi.fn(),
}));

vi.mock("@/data-access/code-generator", () => ({
  withAutoCode: vi.fn(),
}));

vi.mock("@/data-access/credit-batches", () => ({
  getCreditBatchById: mocks.getCreditBatchById,
}));

vi.mock("@/data-access/facilities", () => ({
  getFacilityById: mocks.getFacilityById,
}));

vi.mock("@/data-access/samples", () => ({
  createSample: vi.fn(),
  deleteSample: vi.fn(),
  generateNextSampleCode: vi.fn(),
  getSampleById: mocks.getSampleById,
  getSamples: vi.fn(),
  getSampleStats: vi.fn(),
  isSampleCodeAvailable: vi.fn(),
  updateSample: mocks.updateSample,
}));

vi.mock("@/lib/auth/server", () => ({
  requireOrgContext: mocks.requireOrgContext,
}));

const SAMPLE_ID = "00000000-0000-4000-8000-000000000001";
const CREDIT_BATCH_ID = "00000000-0000-4000-8000-000000000002";
const FACILITY_ID = "00000000-0000-4000-8000-000000000003";
const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000004";
const USER_ID = "00000000-0000-4000-8000-000000000005";
const BATCH_START_DATE = "2026-01-15";

describe("sample credit batch window guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOrgContext.mockResolvedValue({
      userId: USER_ID,
      organizationId: ORGANIZATION_ID,
      orgRole: "admin",
      isPlatformAdmin: false,
    });
    mocks.getSampleById.mockResolvedValue({
      id: SAMPLE_ID,
      creditBatchId: CREDIT_BATCH_ID,
      samplingTime: new Date("2026-01-15T12:00:00.000Z"),
    });
    mocks.getCreditBatchById.mockResolvedValue({
      id: CREDIT_BATCH_ID,
      code: "CB-2026-001",
      facilityId: FACILITY_ID,
      startDate: BATCH_START_DATE,
      endDate: "2026-01-31",
    });
    mocks.getFacilityById.mockResolvedValue({
      id: FACILITY_ID,
      timezone: "UTC",
    });
    mocks.updateSample.mockResolvedValue({ id: SAMPLE_ID });
  });

  it("accepts a sample on the local start day when its UTC day is earlier", async () => {
    mocks.getFacilityById.mockResolvedValue({
      id: FACILITY_ID,
      timezone: "Africa/Nairobi",
    });

    const result = await updateSampleFn({
      sampleId: SAMPLE_ID,
      samplingTime: new Date("2026-01-14T21:30:00.000Z"),
    });

    expect(result.success).toBe(true);
    expect(mocks.updateSample).toHaveBeenCalledOnce();
    expect(mocks.getFacilityById).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORGANIZATION_ID }),
      FACILITY_ID,
    );
  });

  it("rejects a sample locally before the start day even when its UTC day matches", async () => {
    mocks.getFacilityById.mockResolvedValue({
      id: FACILITY_ID,
      timezone: "America/Los_Angeles",
    });

    const result = await updateSampleFn({
      sampleId: SAMPLE_ID,
      samplingTime: new Date("2026-01-15T07:30:00.000Z"),
    });

    expect(result).toEqual({
      success: false,
      error:
        "Sampling date 2026-01-14 cannot be before credit batch CB-2026-001's production window 2026-01-15–2026-01-31.",
    });
    expect(mocks.updateSample).not.toHaveBeenCalled();
  });

  it("accepts a sample clearly inside the local production window", async () => {
    mocks.getFacilityById.mockResolvedValue({
      id: FACILITY_ID,
      timezone: "Africa/Nairobi",
    });

    const result = await updateSampleFn({
      sampleId: SAMPLE_ID,
      samplingTime: new Date("2026-01-20T09:00:00.000Z"),
    });

    expect(result.success).toBe(true);
    expect(mocks.updateSample).toHaveBeenCalledOnce();
  });
});
