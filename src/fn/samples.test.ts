import { beforeEach, describe, expect, it, vi } from "vitest";
import { DomainError } from "@/lib/domain-errors";
import { createSampleFn, deleteSampleFn, updateSampleFn } from "./samples";

/**
 * The Sample actions are thin: they validate the form payload and run the
 * lab sample operations. The window, zone, archive and lineage rules live in
 * the writer and are covered against the database in
 * tests/operation-lab-samples.test.ts.
 */

const mocks = vi.hoisted(() => ({
  requireOrgContext: vi.fn(),
  runOperationInProcess: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({ requireOrgContext: mocks.requireOrgContext }));
vi.mock("@/lib/operations/runner", () => ({ runOperationInProcess: mocks.runOperationInProcess }));
vi.mock("@/lib/operations/lab-samples", () => ({
  recordLabSample: { id: "record_lab_sample" },
  updateLabSample: { id: "update_lab_sample" },
  deleteLabSample: { id: "delete_lab_sample" },
}));
vi.mock("@/data-access/samples", () => ({ getSampleById: vi.fn(), getSamples: vi.fn(), getSampleStats: vi.fn() }));

const SAMPLE_ID = "00000000-0000-4000-8000-000000000001";
const CREDIT_BATCH_ID = "00000000-0000-4000-8000-000000000002";
const WINDOW_MESSAGE = "Sample date 2026-01-14 is before credit batch CB-2026-001's production window, 2026-01-15 to 2026-01-31. Choose a date within or after the production window.";

function operationCall(index = 0) {
  const [operation, , input] = mocks.runOperationInProcess.mock.calls[index];
  return { operationId: (operation as { id: string }).id, input: input as Record<string, unknown> };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireOrgContext.mockResolvedValue({ userId: "user", organizationId: "org", orgRole: "admin", isPlatformAdmin: false });
  mocks.runOperationInProcess.mockResolvedValue({ sample: { id: SAMPLE_ID }, notices: [], warnings: [] });
});

describe("createSampleFn", () => {
  const form = {
    creditBatchId: CREDIT_BATCH_ID,
    samplingTime: new Date("2026-01-15T12:00:00.000Z"),
    totalCarbonPercent: 80,
    organicCarbonPercent: 75,
    totalHydrogenPercent: 1.5,
    hToCOrgRatio: 0.2397,
    labName: "",
    durabilityOption: "200_year" as const,
    nutrientClaimEnabled: false,
  };

  it("runs record_lab_sample and returns the saved Sample as before", async () => {
    expect(await createSampleFn(form)).toEqual({ success: true, data: { id: SAMPLE_ID } });
    const { operationId, input } = operationCall();
    expect(operationId).toBe("record_lab_sample");
    expect(input).toMatchObject({ creditBatchId: CREDIT_BATCH_ID, samplingTime: form.samplingTime, totalHydrogenPercent: 1.5, labName: null });
  });

  it("leaves the ratio calculation and form-only fields to the server", async () => {
    await createSampleFn(form);
    const { input } = operationCall();
    for (const field of ["hToCOrgRatio", "sampleCode", "durabilityOption", "nutrientClaimEnabled", "r0HistogramFileUrl", "tgaThermogramFileUrl"]) {
      expect(input, field).not.toHaveProperty(field);
    }
  });

  it("shows the writer's refusal copy unchanged", async () => {
    mocks.runOperationInProcess.mockRejectedValue(new DomainError("validation_failed", WINDOW_MESSAGE, {
      issues: [{ path: ["samplingTime"], code: "validation_failed", message: WINDOW_MESSAGE }],
    }));
    expect(await createSampleFn(form)).toMatchObject({ success: false, error: WINDOW_MESSAGE });
  });

  it("refuses a Sample without a credit batch before the operation", async () => {
    const { creditBatchId: _omitted, ...withoutBatch } = form;
    void _omitted;
    expect(await createSampleFn(withoutBatch as never)).toMatchObject({ success: false });
    expect(mocks.runOperationInProcess).not.toHaveBeenCalled();
  });
});

describe("updateSampleFn", () => {
  it("runs update_lab_sample with the id, precondition and code under their operation names", async () => {
    const samplingTime = new Date("2026-01-20T09:00:00.000Z");
    const result = await updateSampleFn({ expectedVersion: 3, sampleId: SAMPLE_ID, sampleCode: "SAM-26-009", samplingTime, totalHydrogenPercent: null });
    expect(result).toEqual({ success: true, data: { id: SAMPLE_ID } });
    const { operationId, input } = operationCall();
    expect(operationId).toBe("update_lab_sample");
    expect(input).toMatchObject({ labSampleId: SAMPLE_ID, expectedVersion: 3, code: "SAM-26-009", samplingTime, totalHydrogenPercent: null });
  });

  it("keeps omitted fields omitted, so the stored values stay", async () => {
    await updateSampleFn({ expectedVersion: 1, sampleId: SAMPLE_ID, labName: "Lab" });
    const { input } = operationCall();
    expect(Object.entries(input).filter(([, value]) => value !== undefined).map(([key]) => key).sort())
      .toEqual(["expectedVersion", "labName", "labSampleId"]);
  });
});

describe("deleteSampleFn", () => {
  it("runs delete_lab_sample", async () => {
    expect(await deleteSampleFn({ expectedVersion: 2, sampleId: SAMPLE_ID })).toEqual({ success: true, data: undefined });
    expect(operationCall()).toEqual({ operationId: "delete_lab_sample", input: { labSampleId: SAMPLE_ID, expectedVersion: 2 } });
  });
});
