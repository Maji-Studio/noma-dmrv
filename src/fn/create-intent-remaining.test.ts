import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProductionSampleFn } from "./production-samples";
import { createProductionIncidentFn } from "./production-incidents";
import { createTransportLegFn } from "./transport-legs";
import { createDriverFn, createOperatorFn } from "./quick-add";
import { createCreditBatchFn } from "./credit-batches";

const { auth, run, describeBatch } = vi.hoisted(() => ({ auth: vi.fn(), run: vi.fn(), describeBatch: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ requireOrgContext: auth }));
vi.mock("@/lib/operations/runner", () => ({ runOperationInProcess: run }));
vi.mock("@/lib/operations/production-samples", () => ({ recordProductionSample: { id: "record_production_sample" } }));
vi.mock("@/lib/operations/production-incidents", () => ({ recordProductionIncident: { id: "record_production_incident" } }));
vi.mock("@/lib/operations/transport-legs", () => ({ recordTransportLeg: { id: "record_transport_leg" } }));
vi.mock("@/lib/operations/drivers", () => ({ createDriver: { id: "create_driver" } }));
vi.mock("@/lib/operations/operators", () => ({ createOperator: { id: "create_operator" } }));
vi.mock("@/lib/operations/quick-add", () => ({}));
vi.mock("@/lib/operations/feedstock-types", () => ({}));
vi.mock("@/lib/operations/credit-batches", () => ({ createCreditBatch: { id: "create_credit_batch" } }));
vi.mock("@/data-access/production-samples", () => ({}));
vi.mock("@/data-access/production-incidents", () => ({}));
vi.mock("@/data-access/transport-legs", () => ({}));
vi.mock("@/data-access/quick-add", () => ({}));
vi.mock("@/data-access/credit-batches", () => ({ getCreditBatchCertifierForFacility: async () => null, describeSavedCreditBatch: describeBatch }));
vi.mock("@/data-access/code-generator", () => ({}));
vi.mock("@/data-access/utils", () => ({}));
vi.mock("@/lib/log", () => ({ logger: { error: vi.fn() }, sanitizeErrorMessage: vi.fn() }));

const ID = "11111111-1111-4111-8111-111111111111";
const ctx = { userId: ID, organizationId: ID, orgRole: "admin", isPlatformAdmin: false };
const cases = [
  { id: "record_production_sample", action: createProductionSampleFn, input: { productionRunId: ID, timestamp: new Date("2026-09-12T12:00:00Z"), weightGrams: 100 } },
  { id: "record_production_incident", action: createProductionIncidentFn, input: { productionRunId: ID, incidentTime: new Date("2026-09-12T12:00:00Z"), description: "Incident", severity: "low" as const } },
  { id: "record_transport_leg", action: createTransportLegFn, input: { entityType: "feedstock" as const, entityId: ID, distanceKm: 10, loadMassKg: 100, transportMethodType: "road" as const, calculationMethodType: "distance_based" as const, modelYear: null } },
  { id: "create_driver", action: createDriverFn, input: { name: "Driver" } },
  { id: "create_operator", action: createOperatorFn, input: { name: "Operator" } },
  { id: "create_credit_batch", action: createCreditBatchFn, input: { facilityId: ID, feedstockTypeId: ID, startDate: new Date("2026-09-01"), endDate: new Date("2026-09-30"), sampling: "sampled" as const, productionRunIds: [] } },
];
beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue(ctx);
  run.mockResolvedValue({ id: ID });
  describeBatch.mockResolvedValue({ id: ID, previewAvailable: true });
});

describe.each(cases)("$id intent boundary", ({ id, action, input }) => {
  it("forwards the intent separately from values and preserves keyless callers", async () => {
    expect(await action(input as never, { intentKey: ID })).toMatchObject({ success: true });
    expect(run).toHaveBeenCalledWith({ id }, ctx, expect.not.objectContaining({ intentKey: ID }), { intentKey: ID });
    expect(await action(input as never)).toMatchObject({ success: true });
    expect(run.mock.calls[1][3]).toBeUndefined();
  });
  it("rejects a malformed intent before running the write", async () => {
    expect(await action(input as never, { intentKey: "invalid" })).toMatchObject({ success: false, code: "validation_failed" });
    expect(run).not.toHaveBeenCalled();
    expect(describeBatch).not.toHaveBeenCalled();
  });
});

it("describes the committed credit batch after both the first save and replay", async () => {
  const { input } = cases[5];
  for (let attempt = 0; attempt < 2; attempt++) {
    expect(await createCreditBatchFn(input as Parameters<typeof createCreditBatchFn>[0], { intentKey: ID })).toMatchObject({ success: true });
  }
  expect(describeBatch).toHaveBeenCalledTimes(2);
  expect(describeBatch).toHaveBeenCalledWith(ctx, { id: ID });
  expect(run.mock.invocationCallOrder[0]).toBeLessThan(describeBatch.mock.invocationCallOrder[0]);
  expect(run.mock.invocationCallOrder[1]).toBeLessThan(describeBatch.mock.invocationCallOrder[1]);
});
