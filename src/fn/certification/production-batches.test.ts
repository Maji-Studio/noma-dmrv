import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgContext } from "@/lib/auth/server";
import { MASS_COMPARISON_EPSILON_KG } from "@/lib/calculations/mass-dry";
import type { Logger } from "@/lib/log";
import type { ProductionBatchRegistryInput } from "@/data-access/certifier-production-batches";
import type { IsometricProductionBatch } from "@/lib/isometric/production-batches";
import type { PerformRegistryCreateArgs } from "./registry-create";
import type { DurabilityMeasurementSampleSubmission } from "./durability-measurement-samples";

const mocks = vi.hoisted(() => ({
  getProductionBatchRegistryInputs: vi.fn(),
  getProductionBatchRegistrations: vi.fn(),
  upsertProductionBatchRegistration: vi.fn(),
  appendSyncEventBestEffort: vi.fn(),
  client: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    paginate: vi.fn(),
    paginateAll: vi.fn(),
  },
}));

vi.mock("@/data-access/certifier-production-batches", () => ({
  getProductionBatchRegistryInputs: mocks.getProductionBatchRegistryInputs,
  getProductionBatchRegistrations: mocks.getProductionBatchRegistrations,
  upsertProductionBatchRegistration: mocks.upsertProductionBatchRegistration,
}));

vi.mock("@/lib/isometric/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/isometric/client")>();
  return {
    ...actual,
    getIsometricClientForOrg: vi.fn(async () => mocks.client),
  };
});

vi.mock("./shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./shared")>();
  return { ...actual, appendSyncEventBestEffort: mocks.appendSyncEventBestEffort };
});

vi.mock("./registry-create", () => ({
  supplierRefLookup: (
    result: { found: true; externalId: string } | { found: false },
  ) =>
    result.found
      ? { found: "single" as const, externalId: result.externalId }
      : { found: "none" as const },
  performRegistryCreate: vi.fn(async (args: PerformRegistryCreateArgs) => {
    if (args.resumed) {
      const reconciled = await args.reconcile();
      if (reconciled.found === "single") {
        await args.onConfirmed?.(reconciled.externalId);
        return {
          externalId: reconciled.externalId,
          source: "reconciliation" as const,
        };
      }
      if (reconciled.found === "refused") throw new Error(reconciled.message);
    }
    const externalId = await args.create();
    await args.onConfirmed?.(externalId);
    return { externalId, source: "create" as const };
  }),
}));

import {
  applyProductionBatchIds,
  creditBatchIdsForMeasurementSamples,
} from "./durability-measurement-samples";
import { ensureProductionBatchesForCreditBatches } from "./production-batches";
import { performRegistryCreate } from "./registry-create";

const CREDIT_BATCH_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCTION_BATCH_ID = "ptb_1GAFJ4C051S06E0Z";

const orgCtx: OrgContext = {
  organizationId: "org-1",
  userId: "user-1",
  orgRole: "admin",
  isPlatformAdmin: false,
};

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

function registryInput(
  patch: Partial<ProductionBatchRegistryInput> = {},
): ProductionBatchRegistryInput {
  return {
    creditBatchId: CREDIT_BATCH_ID,
    creditBatchCode: "CB-2026-001",
    startDate: "2026-03-01",
    endDate: "2026-03-28",
    externalProjectId: "prj_1K9YJ33RKSBX9FFF",
    externalFacilityId: "fcl_1G8QT5ZAB1S0XSDW",
    isometricFeedstockTypeId: "ftt_1D7KZ1P761S0G7BN",
    totalDryMassKg: 2_000,
    runsMissingDryMass: 0,
    ...patch,
  };
}

function remoteBatch(
  supplierReferenceId: string,
  id = PRODUCTION_BATCH_ID,
  patch: Partial<IsometricProductionBatch> = {},
): IsometricProductionBatch {
  return {
    display_name: "CB-2026-001",
    ended_at: "2026-03-28T23:59:59.999Z",
    facility_id: "fcl_1G8QT5ZAB1S0XSDW",
    feedstock_type_ids: ["ftt_1D7KZ1P761S0G7BN"],
    id,
    kind: "biochar",
    mass: { magnitude: 2_000, unit: "kg" },
    started_at: "2026-03-01T00:00:00.000Z",
    supplier_reference_id: supplierReferenceId,
    uploaded_at: "2026-03-29T00:00:00.000Z",
    ...patch,
  };
}

function ensure() {
  return ensureProductionBatchesForCreditBatches({
    orgCtx,
    removalId: "removal-1",
    submissionRow: { id: "submission-1" },
    creditBatchIds: [CREDIT_BATCH_ID],
    log,
  });
}

/** Mimics the DB upsert: returns whatever identity the winner holds. */
function upsertReturning(externalProductionBatchId: string) {
  return async (_ctx: unknown, input: { supplierReference: string }) => ({
    id: "row-1",
    organizationId: orgCtx.organizationId,
    provider: "isometric" as const,
    creditBatchId: CREDIT_BATCH_ID,
    externalProductionBatchId,
    supplierReference: input.supplierReference,
    externalProjectId: "prj_1K9YJ33RKSBX9FFF",
    externalFacilityId: "fcl_1G8QT5ZAB1S0XSDW",
    massKg: 2_000,
    startedOn: "2026-03-01",
    endedOn: "2026-03-28",
    payloadHash: "hash",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProductionBatchRegistryInputs.mockResolvedValue([registryInput()]);
  mocks.getProductionBatchRegistrations.mockResolvedValue([]);
  mocks.upsertProductionBatchRegistration.mockImplementation(
    upsertReturning(PRODUCTION_BATCH_ID),
  );
  mocks.client.post.mockImplementation(
    async (_path: string, body: { supplier_reference_id: string }) =>
      remoteBatch(body.supplier_reference_id),
  );
  mocks.client.paginate.mockImplementation(async function* () {});
});

describe("ensureProductionBatchesForCreditBatches", () => {
  it("registers the batch with the dry-mass payload and journals the id", async () => {
    const registered = await ensure();

    expect(mocks.client.post).toHaveBeenCalledTimes(1);
    const [path, body] = mocks.client.post.mock.calls[0];
    expect(path).toBe("/production_batches");
    expect(body.mass).toEqual({ magnitude: 2_000, unit: "kg" });
    expect("standard_deviation" in body.mass).toBe(false);
    expect(body.feedstock_type_ids).toEqual(["ftt_1D7KZ1P761S0G7BN"]);
    expect(body.started_at).toBe("2026-03-01T00:00:00.000Z");
    expect(body.ended_at).toBe("2026-03-28T23:59:59.999Z");
    expect(mocks.upsertProductionBatchRegistration).toHaveBeenCalledTimes(1);
    expect(mocks.upsertProductionBatchRegistration).toHaveBeenCalledWith(
      orgCtx,
      expect.objectContaining({
        externalProjectId: "prj_1K9YJ33RKSBX9FFF",
        externalFacilityId: "fcl_1G8QT5ZAB1S0XSDW",
      }),
    );
    expect(registered.get(CREDIT_BATCH_ID)).toBe(PRODUCTION_BATCH_ID);
  });

  it("always reconciles by supplier reference before POSTing a missing journal", async () => {
    await ensure();

    // POST /production_batches is not idempotent: a missing journal row must
    // trigger the pre-POST supplier-reference lookup even on a fresh,
    // non-resumed submission version (#635).
    expect(performRegistryCreate).toHaveBeenCalledWith(
      expect.objectContaining({ resumed: true }),
    );
  });

  it("POSTs in credit-batch id order regardless of DB row order", async () => {
    const secondId = "22222222-2222-4222-8222-222222222222";
    mocks.getProductionBatchRegistryInputs.mockResolvedValue([
      registryInput({ creditBatchId: secondId, creditBatchCode: "CB-2026-002" }),
      registryInput(),
    ]);
    mocks.client.post.mockImplementation(
      async (_path: string, body: { supplier_reference_id: string }) =>
        remoteBatch(body.supplier_reference_id, PRODUCTION_BATCH_ID),
    );
    mocks.upsertProductionBatchRegistration.mockImplementation(
      async (_ctx: unknown, input: { externalProductionBatchId: string }) => ({
        externalProductionBatchId: input.externalProductionBatchId,
      }),
    );

    await ensureProductionBatchesForCreditBatches({
      orgCtx,
      removalId: "removal-1",
      submissionRow: { id: "submission-1" },
      creditBatchIds: [secondId, CREDIT_BATCH_ID],
      log,
    });

    expect(mocks.client.post).toHaveBeenCalledTimes(2);
    expect(
      mocks.client.post.mock.calls.map(
        (call) => (call[1] as { display_name: string }).display_name,
      ),
    ).toEqual(["CB-2026-001", "CB-2026-002"]);
  });

  it("reuses a persisted registration without touching the registry", async () => {
    mocks.getProductionBatchRegistrations.mockResolvedValue([
      {
        creditBatchId: CREDIT_BATCH_ID,
        externalProductionBatchId: PRODUCTION_BATCH_ID,
        payloadHash: await currentPayloadHash(),
      },
    ]);

    const registered = await ensure();

    expect(mocks.client.post).not.toHaveBeenCalled();
    expect(performRegistryCreate).not.toHaveBeenCalled();
    expect(mocks.appendSyncEventBestEffort).not.toHaveBeenCalled();
    expect(registered.get(CREDIT_BATCH_ID)).toBe(PRODUCTION_BATCH_ID);
  });

  it("records drift when the batch data changed after registration", async () => {
    mocks.getProductionBatchRegistrations.mockResolvedValue([
      {
        creditBatchId: CREDIT_BATCH_ID,
        externalProductionBatchId: PRODUCTION_BATCH_ID,
        payloadHash: "a-stale-hash",
      },
    ]);

    const registered = await ensure();

    expect(mocks.client.post).not.toHaveBeenCalled();
    expect(registered.get(CREDIT_BATCH_ID)).toBe(PRODUCTION_BATCH_ID);
    const [, event] = mocks.appendSyncEventBestEffort.mock.calls[0];
    expect(event.operation).toBe(
      `production-batch:drift:${CREDIT_BATCH_ID}`,
    );
  });

  it("reuses a registration whose local data no longer builds a payload", async () => {
    mocks.getProductionBatchRegistryInputs.mockResolvedValue([
      registryInput({ externalFacilityId: null }),
    ]);
    mocks.getProductionBatchRegistrations.mockResolvedValue([
      {
        creditBatchId: CREDIT_BATCH_ID,
        externalProductionBatchId: PRODUCTION_BATCH_ID,
        payloadHash: "a-stale-hash",
      },
    ]);

    const registered = await ensure();

    expect(registered.get(CREDIT_BATCH_ID)).toBe(PRODUCTION_BATCH_ID);
    expect(mocks.client.post).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalled();
  });

  it("claims an orphaned remote record instead of re-POSTing", async () => {
    mocks.client.paginate.mockImplementation(async function* () {
      yield remoteBatch(await currentSupplierRef());
    });

    const registered = await ensure();

    expect(mocks.client.post).not.toHaveBeenCalled();
    expect(registered.get(CREDIT_BATCH_ID)).toBe(PRODUCTION_BATCH_ID);
    expect(mocks.upsertProductionBatchRegistration).toHaveBeenCalledTimes(1);
  });

  it("claims an orphaned record within the dry-mass precision tolerance", async () => {
    mocks.client.paginate.mockImplementation(async function* () {
      yield remoteBatch(await currentSupplierRef(), PRODUCTION_BATCH_ID, {
        mass: {
          magnitude: 2_000 + MASS_COMPARISON_EPSILON_KG,
          unit: "kg",
        },
      });
    });

    const registered = await ensure();

    expect(mocks.client.post).not.toHaveBeenCalled();
    expect(registered.get(CREDIT_BATCH_ID)).toBe(PRODUCTION_BATCH_ID);
    expect(mocks.upsertProductionBatchRegistration).toHaveBeenCalledWith(
      orgCtx,
      expect.objectContaining({
        externalProductionBatchId: PRODUCTION_BATCH_ID,
      }),
    );
  });

  it("claims an orphaned decimal-mass record exactly 1 g apart", async () => {
    mocks.getProductionBatchRegistryInputs.mockResolvedValue([
      registryInput({ totalDryMassKg: 10.1 }),
    ]);
    mocks.client.paginate.mockImplementation(async function* () {
      yield remoteBatch(await currentSupplierRef(), PRODUCTION_BATCH_ID, {
        mass: { magnitude: 10.101, unit: "kg" },
      });
    });

    await expect(ensure()).resolves.toEqual(
      new Map([[CREDIT_BATCH_ID, PRODUCTION_BATCH_ID]]),
    );
    expect(mocks.client.post).not.toHaveBeenCalled();
  });

  it("refuses an orphaned decimal-mass record more than 1 g apart", async () => {
    mocks.getProductionBatchRegistryInputs.mockResolvedValue([
      registryInput({ totalDryMassKg: 10.1 }),
    ]);
    mocks.client.paginate.mockImplementation(async function* () {
      yield remoteBatch(await currentSupplierRef(), PRODUCTION_BATCH_ID, {
        mass: { magnitude: 10.101_001, unit: "kg" },
      });
    });

    await expect(ensure()).rejects.toThrow(
      /does not match this credit batch/,
    );
    expect(mocks.client.post).not.toHaveBeenCalled();
  });

  it("matches an orphaned record whose timestamps express the same instants", async () => {
    mocks.client.paginate.mockImplementation(async function* () {
      yield remoteBatch(await currentSupplierRef(), PRODUCTION_BATCH_ID, {
        started_at: "2026-02-28T19:00:00-05:00",
        ended_at: "2026-03-29T00:59:59.999+01:00",
      });
    });

    const registered = await ensure();

    expect(mocks.client.post).not.toHaveBeenCalled();
    expect(registered.get(CREDIT_BATCH_ID)).toBe(PRODUCTION_BATCH_ID);
  });

  it.each([
    ["facility", { facility_id: "fcl_other" }],
    ["mass", { mass: { magnitude: 1_999, unit: "kg" } }],
    ["window", { ended_at: "2026-03-29T23:59:59.999Z" }],
  ])(
    "refuses an orphaned remote record with mismatched %s identity",
    async (_label, patch) => {
      mocks.client.paginate.mockImplementation(async function* () {
        yield remoteBatch(
          await currentSupplierRef(),
          PRODUCTION_BATCH_ID,
          patch,
        );
      });

      await expect(ensure()).rejects.toThrow(/does not match this credit batch/);
      expect(mocks.client.post).not.toHaveBeenCalled();
      expect(mocks.upsertProductionBatchRegistration).not.toHaveBeenCalled();
      const registryCreateArgs = vi.mocked(performRegistryCreate).mock
        .calls[0][0];
      await expect(registryCreateArgs.reconcile()).resolves.toMatchObject({
        found: "refused",
        message: expect.stringMatching(/does not match this credit batch/),
      });
    },
  );

  it("POSTs when no remote record carries the reference", async () => {
    const registered = await ensure();
    expect(mocks.client.post).toHaveBeenCalledTimes(1);
    expect(registered.get(CREDIT_BATCH_ID)).toBe(PRODUCTION_BATCH_ID);
  });

  it("refuses a registry record whose supplier reference is not ours", async () => {
    mocks.client.post.mockResolvedValue(remoteBatch("nm-ptb-someone-else"));
    await expect(ensure()).rejects.toThrow(/does not match this credit batch/);
  });

  it("refuses when a concurrent registration already claimed a different batch", async () => {
    mocks.upsertProductionBatchRegistration.mockImplementation(
      upsertReturning("ptb_other"),
    );
    await expect(ensure()).rejects.toThrow(/already registered/);
  });

  it("refuses a credit batch with no mapped Isometric feedstock type", async () => {
    mocks.getProductionBatchRegistryInputs.mockResolvedValue([
      registryInput({ isometricFeedstockTypeId: null }),
    ]);
    await expect(ensure()).rejects.toThrow(/feedstock type/);
  });

  it("refuses a credit batch with no recorded dry mass", async () => {
    mocks.getProductionBatchRegistryInputs.mockResolvedValue([
      registryInput({ totalDryMassKg: 0 }),
    ]);
    await expect(ensure()).rejects.toThrow(/dry biochar mass/);
  });

  it("refuses a credit batch whose member run was never weighed", async () => {
    mocks.getProductionBatchRegistryInputs.mockResolvedValue([
      registryInput({ runsMissingDryMass: 1 }),
    ]);
    await expect(ensure()).rejects.toThrow(/no dry biochar mass recorded/);
    expect(mocks.client.post).not.toHaveBeenCalled();
  });

  it("skips the registry entirely when no credit batch needs one", async () => {
    const registered = await ensureProductionBatchesForCreditBatches({
      orgCtx,
      removalId: "removal-1",
      submissionRow: { id: "submission-1" },
      creditBatchIds: [],
      log,
    });
    expect(registered.size).toBe(0);
    expect(mocks.getProductionBatchRegistryInputs).not.toHaveBeenCalled();
  });
});

describe("measurement-sample binding", () => {
  const perBatch = {
    operationKey: `pb:${CREDIT_BATCH_ID}`,
    supplierRefId: "nm-mts-x-pb-y-v1",
    label: "production batch CB-2026-001",
    body: { production_batch_id: null },
  } as unknown as DurabilityMeasurementSampleSubmission;
  const soil = {
    operationKey: "soil",
    supplierRefId: "nm-mts-x-soil-v1",
    label: "soil",
    body: { production_batch_id: null },
  } as unknown as DurabilityMeasurementSampleSubmission;

  it("collects only the credit batches that have a per-batch sample", () => {
    expect(creditBatchIdsForMeasurementSamples([perBatch, soil])).toEqual([
      CREDIT_BATCH_ID,
    ]);
  });

  it("stamps the registered production batch onto the per-batch sample", () => {
    const [bound, untouched] = applyProductionBatchIds(
      [perBatch, soil],
      new Map([[CREDIT_BATCH_ID, PRODUCTION_BATCH_ID]]),
    );
    expect(bound.body.production_batch_id).toBe(PRODUCTION_BATCH_ID);
    expect(untouched.body.production_batch_id).toBeNull();
  });

  it("fails closed rather than submitting a null production batch", () => {
    expect(() => applyProductionBatchIds([perBatch], new Map())).toThrow(
      /production batch/,
    );
  });
});

/** The reference/hash the ensure path derives for the fixture credit batch. */
async function currentSupplierRef(): Promise<string> {
  const { buildProductionBatchReference } = await import(
    "@/lib/isometric/production-batches"
  );
  return buildProductionBatchReference({ creditBatchId: CREDIT_BATCH_ID });
}

async function currentPayloadHash(): Promise<string> {
  const { buildProductionBatchSubmissions } = await import(
    "./production-batches"
  );
  return buildProductionBatchSubmissions([registryInput()])[0].payloadHash;
}
