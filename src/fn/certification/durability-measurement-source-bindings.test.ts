import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SafeError } from "@/lib/errors";
import type { RemovalSourceBindingPlanEntry } from "@/lib/certification/removal-source-bindings";
import { IsometricApiError } from "@/lib/isometric/client";
import { testIsometricClient } from "../../../tests/fixtures/isometric-client";
import { encodeMeasurementProperty } from "@/lib/isometric/utils/measurement-property";
import { TOTAL_CARBON_CONTENTS_1000_YEAR_MEASUREMENT_PROPERTY } from "@/lib/isometric/transformers/measurement-sample";
import { CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR } from "@/lib/isometric/storage-blueprints";
import { patchMeasurementSampleSourceBindings } from "./durability-measurement-samples";

const log = vi.hoisted(() => {
  const log = { child: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  log.child.mockReturnValue(log);
  return log;
});
vi.mock("@/lib/log", () => ({ logger: log }));

const RETRY_AFTER_MS = 1000;
const fetchMock = vi.fn<typeof fetch>();
const sourceIds = ["source-a", "source-b"];
const sourceBindingPlan: RemovalSourceBindingPlanEntry[] = sourceIds.map(sourceId => ({
  documentId: `document-${sourceId}`, sourceId, nomaRole: "durability_evidence_ledger",
  lineage: { entityType: "credit_batch", entityId: "batch-1", entityLabel: "Credit batch CB-001" },
  intendedTarget: {
    kind: "sequestration", groupKey: "co2-stored", componentId: "component-1",
    componentBlueprintKey: CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR,
    inputKey: "total_carbon_contents", creditBatchIds: ["batch-1"],
  },
  mappingRevision: "revision-1",
}));
const bind = () => patchMeasurementSampleSourceBindings({
  client: testIsometricClient(), sourceBindingPlan,
  captures: [{
    measurementSampleId: "sample-1", supplierReferenceId: "sample-ref-1", creditBatchId: "batch-1",
    datapointIdsByMeasurementProperty: new Map([
      [encodeMeasurementProperty(TOTAL_CARBON_CONTENTS_1000_YEAR_MEASUREMENT_PROPERTY), ["datapoint-1"]],
    ]),
  }],
});
const datapoint = (ids: string[]) => Response.json({
  id: "datapoint-1", source_ids: ids, locked_status: "locked_measurement_sample_datapoint",
});
const methods = () => fetchMock.mock.calls.map(([, init]) => init?.method);

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(Math, "random").mockReturnValue(0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("measurement sample Source reuse", () => {
  it("counts an already-bound locked Datapoint without PATCH, including extra remote Sources", async () => {
    fetchMock.mockResolvedValueOnce(datapoint(["source-extra", "source-b", "source-a"]));
    await expect(bind()).resolves.toBe(1);
    expect(methods()).toEqual(["GET"]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.sandbox.isometric.com/mrv/v0/datapoints/datapoint-1");
  });

  it("PATCHes the full wanted Source set when any Source is missing", async () => {
    fetchMock.mockResolvedValueOnce(datapoint(["source-a"]))
      .mockResolvedValueOnce(datapoint(sourceIds));
    await expect(bind()).resolves.toBe(1);
    expect(methods()).toEqual(["GET", "PATCH"]);
    const body = JSON.parse(fetchMock.mock.calls[1][1]!.body as string);
    expect(body.source_ids).toEqual(sourceIds);
    expect(body.quantity).toEqual({ __typename: "Undefined" });
  });

  it.each([429, 500, 503])("retries the Source PATCH after HTTP %i and respects Retry-After", async status => {
    fetchMock.mockResolvedValueOnce(datapoint([]))
      .mockResolvedValueOnce(new Response("busy", { status, headers: { "retry-after": "1" } }))
      .mockResolvedValueOnce(datapoint(sourceIds));
    const result = bind();
    await vi.advanceTimersByTimeAsync(RETRY_AFTER_MS - 1);
    expect(methods()).toEqual(["GET", "PATCH"]);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe(1);
    expect(methods()).toEqual(["GET", "PATCH", "PATCH"]);
    expect(fetchMock.mock.calls[1][1]!.body).toBe(fetchMock.mock.calls[2][1]!.body);
  });

  it("retries the Source PATCH after a network error", async () => {
    fetchMock.mockResolvedValueOnce(datapoint([]))
      .mockRejectedValueOnce(new TypeError("connection lost"))
      .mockResolvedValueOnce(datapoint(sourceIds));
    const result = bind();
    await vi.runAllTimersAsync();
    await expect(result).resolves.toBe(1);
    expect(methods()).toEqual(["GET", "PATCH", "PATCH"]);
  });

  it.each([400, 403, 409, 422])("explains a non-retryable HTTP %i PATCH refusal with a SafeError", async status => {
    fetchMock.mockResolvedValueOnce(datapoint([]))
      .mockResolvedValueOnce(new Response("refused", { status }));
    const error = await bind().catch((error: unknown) => error);
    expect(error).toBeInstanceOf(SafeError);
    expect(error).toMatchObject({ message: "Isometric refused the Sources for registry value datapoint-1. Check its Sources in Isometric before submitting again." });
    expect(methods()).toEqual(["GET", "PATCH"]);
  });

  it("preserves the HTTP error when rate-limit retries are exhausted", async () => {
    fetchMock.mockResolvedValueOnce(datapoint([]))
      .mockImplementation(async () => new Response("busy", { status: 429 }));
    const result = bind().catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    expect(await result).toBeInstanceOf(IsometricApiError);
    expect(await result).toMatchObject({ status: 429 });
    expect(methods()).toEqual(["GET", "PATCH", "PATCH", "PATCH"]);
  });

  it("still rejects a PATCH response that loses a wanted Source", async () => {
    fetchMock.mockResolvedValueOnce(datapoint([]))
      .mockResolvedValueOnce(datapoint(["source-a"]));
    await expect(bind()).rejects.toMatchObject({ name: "SafeError", message: expect.stringContaining("did not keep its Sources") });
  });

  it("does not PATCH when the preceding GET is refused", async () => {
    fetchMock.mockResolvedValueOnce(new Response("refused", { status: 403 }));
    await expect(bind()).rejects.toBeInstanceOf(IsometricApiError);
    expect(methods()).toEqual(["GET"]);
  });
});
