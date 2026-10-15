import { expect, it, vi } from "vitest";
vi.mock("@/lib/log", () => ({ logger: { error: vi.fn(), warn: vi.fn(), child: vi.fn() } }));
import { assertSamplingTimeNotFuture } from "@/data-access/samples/future-time";
import { staleRowVersion } from "@/data-access/row-version";
import { toActionFailure } from "@/fn/action-errors";
import { SampleRatioCapError } from "@/lib/calculations/sample-ratios";
import { conflictCode } from "@/lib/conflict-ref";
import { DomainError } from "@/lib/domain-errors";
import { ActionConflictError, SafeError } from "@/lib/errors";
import { RATIO_INPUT_MAX } from "@/schemas/helpers";
import {
  sampleBeforeBatchWindowError,
  sampleCarbonReconciliationError,
  sampleCreditBatchArchived,
  sampleCreditBatchNotFound,
  withSampleErrors,
} from "./sample-domain-errors";

const failureOptions = { fallbackMessage: "Failed to save", log: { message: "test" } };

async function outcome(error: unknown) {
  return withSampleErrors(async () => { throw error; }).catch((failure: unknown) => failure);
}

it("keeps the legacy operator copy byte for byte", () => {
  // The writers throw these strings today (src/data-access/samples.ts, src/fn/samples.ts).
  expect(sampleCreditBatchNotFound().message).toBe(new SafeError("Credit batch not found").message);
  expect(sampleBeforeBatchWindowError("2026-01-31", { code: "CB-26-001", startDate: "2026-02-01", endDate: "2026-02-28" }).message)
    .toBe("Sample date 2026-01-31 is before credit batch CB-26-001's production window, 2026-02-01 to 2026-02-28. Choose a date within or after the production window.");
  expect(sampleCarbonReconciliationError("organicCarbonPercent").message)
    .toBe("Organic carbon cannot exceed total carbon by more than 0.5 percentage points. Correct the carbon values.");
  expect(sampleCarbonReconciliationError("inorganicCarbonPercent").message)
    .toBe("Organic plus inorganic carbon cannot exceed total carbon by more than 0.5 percentage points. Correct the carbon values.");
});

it("answers a missing or archived credit batch with not_found on /creditBatchId", async () => {
  for (const error of [sampleCreditBatchNotFound(), sampleCreditBatchArchived("CB-26-004")]) {
    await expect(outcome(error)).resolves.toMatchObject({
      code: "not_found", message: error.message, issues: [{ path: ["creditBatchId"], code: "not_found", message: error.message }],
    });
  }
  expect(sampleCreditBatchArchived("CB-26-004").message).toBe("Credit batch CB-26-004 is archived. Choose an active credit batch.");
});

it.each([
  ["organicCarbonPercent", sampleCarbonReconciliationError("organicCarbonPercent")],
  ["inorganicCarbonPercent", sampleCarbonReconciliationError("inorganicCarbonPercent")],
  ["samplingTime", sampleBeforeBatchWindowError("2026-01-31", { code: "CB-26-001", startDate: "2026-02-01", endDate: "2026-02-28" })],
] as const)("points a refused %s at its input", async (field, error) => {
  await expect(outcome(error)).resolves.toMatchObject({
    code: "validation_failed", message: error.message, issues: [{ path: [field], code: "validation_failed", message: error.message }],
  });
});

it("points a calculated ratio above the stored maximum at the element behind it", async () => {
  const error = new SampleRatioCapError("hToCOrgRatio", 10);
  await expect(outcome(error)).resolves.toMatchObject({
    code: "validation_failed",
    issues: [{ path: ["totalHydrogenPercent"], code: "validation_failed", meta: { ratio: "hToCOrgRatio", max: RATIO_INPUT_MAX } }],
  });
  await expect(outcome(new SampleRatioCapError("oToCOrgRatio", 12.5))).resolves.toMatchObject({ issues: [{ path: ["totalOxygenPercent"] }] });
});

it("refuses a future sampling time on /samplingTime with the shared future-time helper", () => {
  const now = new Date("2026-10-13T08:00:00Z");
  expect(() => assertSamplingTimeNotFuture(now, now)).not.toThrow();
  expect(() => assertSamplingTimeNotFuture(new Date("2026-10-13T08:00:01Z"), now)).toThrow(expect.objectContaining({
    code: "validation_failed",
    message: "Sampling time cannot be in the future. Enter a time at or before now.",
    issues: [expect.objectContaining({ path: ["samplingTime"] })],
  }));
});

it("passes typed outcomes through, keeps conflicts and leaves unexpected failures alone", async () => {
  const stale = staleRowVersion("sample", "sample-id");
  await expect(outcome(stale)).resolves.toBe(stale);
  const locked = new DomainError("certification_locked", "Submitted.");
  await expect(outcome(locked)).resolves.toBe(locked);
  const conflict = { entity: "sample", id: "sample-id", code: conflictCode("SAM-26-001") };
  await expect(outcome(new ActionConflictError("In use.", conflict))).resolves.toMatchObject({ code: "conflict", conflict });
  const unexpected = new Error("connection reset");
  await expect(outcome(unexpected)).resolves.toBe(unexpected);
  await expect(withSampleErrors(async () => { throw new SafeError("Choose a lab."); }, ["labName"]).catch((e: unknown) => e))
    .resolves.toMatchObject({ code: "validation_failed", issues: [{ path: ["labName"] }] });
});

it("shows the operator the same text through a Server Action, typed or not", async () => {
  const error = sampleCarbonReconciliationError("organicCarbonPercent");
  const legacy = new SafeError(error.message);
  const typed = await outcome(error);
  expect(toActionFailure(typed, failureOptions)).toMatchObject({ success: false, code: "validation_failed", error: legacy.message });
});
