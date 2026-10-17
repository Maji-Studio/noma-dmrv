import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductionBatchRegistryInput } from "@/data-access/certifier-production-batches";
import { markSubmissionRejected } from "@/data-access/certification";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { IsometricApiError } from "@/lib/isometric/client";
import { payloadHash } from "@/lib/isometric/utils/payload-hash";
import type { Logger } from "@/lib/log";
import { buildProductionBatchSubmission } from "./production-batches";
import { assertRegisteredProductionBatchesMatch } from "./production-batch-precheck";
import { performRegistryCreate } from "./registry-create";

const mocks = vi.hoisted(() => ({
  getProductionBatchRegistryInputs: vi.fn(),
  getProductionBatchRegistrations: vi.fn(),
  migrateProductionBatchPayloadHash: vi.fn(),
  upsertProductionBatchRegistration: vi.fn(),
  replaceMissingProductionBatchRegistration: vi.fn(),
  appendSyncEventBestEffort: vi.fn(),
  isProductionBatchSharedWithOtherRemovals: vi.fn(),
  client: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), paginate: vi.fn() },
}));

vi.mock("@/data-access/certifier-credentials", () => ({
  resolveIsometricClient: vi.fn(async () => mocks.client),
}));
vi.mock("@/data-access/certifier-production-batches", () => ({
  getProductionBatchRegistryInputs: mocks.getProductionBatchRegistryInputs,
  getProductionBatchRegistrations: mocks.getProductionBatchRegistrations,
  migrateProductionBatchPayloadHash: mocks.migrateProductionBatchPayloadHash,
  upsertProductionBatchRegistration: mocks.upsertProductionBatchRegistration,
  replaceMissingProductionBatchRegistration: mocks.replaceMissingProductionBatchRegistration,
}));
vi.mock("@/data-access/removal-production-batch-deletion", () => ({
  isProductionBatchSharedWithOtherRemovals: mocks.isProductionBatchSharedWithOtherRemovals,
}));
vi.mock("@/data-access/certification");
vi.mock("./shared", async (importOriginal) => ({
  ...await importOriginal<typeof import("./shared")>(),
  appendSyncEventBestEffort: mocks.appendSyncEventBestEffort,
}));
vi.mock("./registry-create", async (importOriginal) => ({
  ...await importOriginal<typeof import("./registry-create")>(),
  performRegistryCreate: vi.fn(),
}));

const NEW_BATCH_ID = "00000000-0000-4000-8000-000000000000";
const CREDIT_BATCH_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCTION_BATCH_ID = "ptb_1GAFJ4C051S06E0Z";
const orgCtx: OrgContext = {
  organizationId: "org-1", userId: "user-1", orgRole: "admin", isPlatformAdmin: false,
};
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

function registryInput(patch: Partial<ProductionBatchRegistryInput> = {}): ProductionBatchRegistryInput {
  return {
    creditBatchId: CREDIT_BATCH_ID,
    creditBatchCode: "CB-2026-001",
    startDate: "2026-03-01",
    endDate: "2026-03-28",
    startedAt: "2026-03-01T07:15:00.000Z",
    endedAt: "2026-03-28T18:45:00.000Z",
    externalProjectId: "prj_1K9YJ33RKSBX9FFF",
    externalFacilityId: "fcl_1G8QT5ZAB1S0XSDW",
    isometricFeedstockTypeId: "ftt_1D7KZ1P761S0G7BN",
    totalDryMassKg: 2_000,
    runsMissingDryMass: 0,
    runsMissingEndTime: 0,
    ...patch,
  };
}

function registration(input = registryInput()) {
  const current = buildProductionBatchSubmission(input);
  return {
    creditBatchId: input.creditBatchId,
    externalProductionBatchId: PRODUCTION_BATCH_ID,
    supplierReference: current.supplierRefId,
    externalProjectId: input.externalProjectId,
    externalFacilityId: input.externalFacilityId,
    payloadHash: current.payloadHash,
  };
}

function remoteBatch() {
  return {
    ...buildProductionBatchSubmission(registryInput()).body,
    id: PRODUCTION_BATCH_ID,
    uploaded_at: "2026-03-29T00:00:00.000Z",
  };
}

function precheck(creditBatchIds = [CREDIT_BATCH_ID]) {
  return assertRegisteredProductionBatchesMatch({ orgCtx, removalId: "removal-1", creditBatchIds, log });
}

function expectNoWrites() {
  expect(mocks.client.post).not.toHaveBeenCalled();
  expect(mocks.client.patch).not.toHaveBeenCalled();
  expect(mocks.client.paginate).not.toHaveBeenCalled();
  expect(performRegistryCreate).not.toHaveBeenCalled();
  expect(mocks.migrateProductionBatchPayloadHash).not.toHaveBeenCalled();
  expect(mocks.upsertProductionBatchRegistration).not.toHaveBeenCalled();
  expect(mocks.replaceMissingProductionBatchRegistration).not.toHaveBeenCalled();
  expect(markSubmissionRejected).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getProductionBatchRegistryInputs.mockResolvedValue([registryInput()]);
  mocks.getProductionBatchRegistrations.mockResolvedValue([registration()]);
  mocks.client.get.mockResolvedValue(remoteBatch());
  mocks.isProductionBatchSharedWithOtherRemovals.mockResolvedValue(false);
});

describe("assertRegisteredProductionBatchesMatch", () => {
  it("stops a mixed Removal before a new earlier batch or any later submission work is sent", async () => {
    const laterId = "22222222-2222-4222-8222-222222222222";
    mocks.getProductionBatchRegistryInputs.mockResolvedValue([
      registryInput({ creditBatchId: laterId }),
      registryInput({ totalDryMassKg: 1_150 }),
      registryInput({ creditBatchId: NEW_BATCH_ID }),
    ]);
    mocks.getProductionBatchRegistrations.mockResolvedValue([
      registration(), registration(registryInput({ creditBatchId: laterId })),
    ]);
    const continueSubmission = vi.fn();
    const pending = precheck([laterId, CREDIT_BATCH_ID, NEW_BATCH_ID]).then(continueSubmission);

    await expect(pending).rejects.toBeInstanceOf(SafeError);
    await expect(pending).rejects.toThrow(
      "Dry mass: Isometric 2,000 kg, noma 1,150 kg.",
    );
    expect(continueSubmission).not.toHaveBeenCalled();
    expect(mocks.client.get).toHaveBeenCalledExactlyOnceWith(`/production_batches/${PRODUCTION_BATCH_ID}`);
    expect(mocks.appendSyncEventBestEffort).toHaveBeenCalledExactlyOnceWith(
      orgCtx,
      expect.objectContaining({
        entityId: "removal-1",
        operation: `production-batch:drift:${CREDIT_BATCH_ID}`,
        status: "failed",
        errorMessage: expect.stringContaining("different figures than noma has now"),
        responsePayload: expect.objectContaining({ reused: false }),
      }),
      { submissionId: undefined },
    );
    expectNoWrites();
  });

  it("passes a matching registration without events", async () => {
    await expect(precheck()).resolves.toBeUndefined();
    expect(mocks.client.get).toHaveBeenCalledOnce();
    expect(mocks.appendSyncEventBestEffort).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it("records nothing for a display-only hash change", async () => {
    mocks.getProductionBatchRegistryInputs.mockResolvedValue([registryInput({ creditBatchCode: "CB-RENAMED" })]);
    await expect(precheck()).resolves.toBeUndefined();
    expect(mocks.appendSyncEventBestEffort).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it("skips a missing remote without attempting recovery", async () => {
    mocks.client.get.mockRejectedValue(new IsometricApiError("ProductionBatch not found", 404));
    await expect(precheck()).resolves.toBeUndefined();
    expect(mocks.appendSyncEventBestEffort).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it("leaves legacy date-bound hash migration to the registration loop", async () => {
    const current = buildProductionBatchSubmission(registryInput());
    const legacyHash = payloadHash({
      ...current.body, started_at: "2026-03-01T00:00:00.000Z", ended_at: "2026-03-28T23:59:59.999Z",
    });
    mocks.getProductionBatchRegistrations.mockResolvedValue([{ ...registration(), payloadHash: legacyHash }]);
    await expect(precheck()).resolves.toBeUndefined();
    expect(mocks.appendSyncEventBestEffort).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it.each([
    { id: "ptb_other" },
    { supplier_reference_id: "other-reference" },
    { facility_id: "fcl_other" },
  ])("silently leaves remote identity mismatches to the loop: %j", async (patch) => {
    mocks.client.get.mockResolvedValue({ ...remoteBatch(), ...patch });
    await expect(precheck()).resolves.toBeUndefined();
    expect(mocks.appendSyncEventBestEffort).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it.each([
    { externalProjectId: "prj_other" },
    { isometricFeedstockTypeId: null },
  ])("silently leaves mapping mismatches and unbuildable payloads to the loop: %j", async (patch) => {
    mocks.getProductionBatchRegistryInputs.mockResolvedValue([registryInput(patch)]);
    await expect(precheck()).resolves.toBeUndefined();
    expect(mocks.appendSyncEventBestEffort).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it("stops on a changed local facility before any write", async () => {
    mocks.getProductionBatchRegistryInputs.mockResolvedValue([registryInput({ externalFacilityId: "fcl_new" })]);
    await expect(precheck()).rejects.toThrow("Facility: Isometric fcl_1G8QT5ZAB1S0XSDW, noma fcl_new.");
    expect(mocks.appendSyncEventBestEffort).toHaveBeenCalledExactlyOnceWith(
      orgCtx,
      expect.objectContaining({ operation: `production-batch:drift:${CREDIT_BATCH_ID}`, status: "failed" }),
      { submissionId: undefined },
    );
    expectNoWrites();
  });

  it("never looks up an unregistered batch", async () => {
    mocks.getProductionBatchRegistrations.mockResolvedValue([]);
    await expect(precheck()).resolves.toBeUndefined();
    expect(mocks.client.get).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it("does no work for an empty member list", async () => {
    await expect(precheck([])).resolves.toBeUndefined();
    expect(mocks.getProductionBatchRegistryInputs).not.toHaveBeenCalled();
    expect(mocks.getProductionBatchRegistrations).not.toHaveBeenCalled();
    expect(mocks.client.get).not.toHaveBeenCalled();
    expectNoWrites();
  });
});
