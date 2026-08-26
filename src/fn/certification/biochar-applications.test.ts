import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CertificationSubmissionRow } from "@/data-access/certification";
import type { CertifierBiocharApplication } from "@/db/schema/certifier-biochar-applications";
import type { OrgContext } from "@/lib/auth/server";
import type { IsometricBiocharApplication } from "@/lib/isometric/biochar-applications";
import { payloadHash } from "@/lib/isometric/utils/payload-hash";
import type { Logger } from "@/lib/log";
import type { PerformRegistryCreateArgs } from "./registry-create";
import type { BiocharApplicationIntent } from "./biochar-application-intents";

const mocks = vi.hoisted(() => ({
  registration: null as CertifierBiocharApplication | null,
  events: [] as string[],
  getRegistration: vi.fn(),
  claim: vi.fn(),
  confirm: vi.fn(),
  markDrift: vi.fn(),
  getProductionRegistrations: vi.fn(),
  ensureProduction: vi.fn(),
  ensureStorage: vi.fn(),
  withLock: vi.fn(async (_key: string, fn: () => Promise<unknown>) => fn()),
  client: { get: vi.fn(), post: vi.fn() },
}));

// Spread the real module so withBiocharApplicationRegistrationLock keeps
// running against the mocked @/db advisory lock below.
vi.mock("@/data-access/certifier-biochar-applications", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/data-access/certifier-biochar-applications")
  >()),
  getBiocharApplicationRegistration: mocks.getRegistration,
  claimBiocharApplicationRegistration: mocks.claim,
  confirmBiocharApplicationRegistration: mocks.confirm,
  markBiocharApplicationDrift: mocks.markDrift,
}));
vi.mock("@/data-access/certifier-production-batches", () => ({
  getProductionBatchRegistrations: mocks.getProductionRegistrations,
}));
vi.mock("@/db", () => ({ withDedicatedSessionAdvisoryLock: mocks.withLock }));
vi.mock("@/lib/auth/server", () => ({ requireOrgRole: vi.fn() }));
vi.mock("@/lib/isometric/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/isometric/client")>()),
  getIsometricClientForOrg: vi.fn(async () => mocks.client),
}));
vi.mock("./production-batches", () => ({
  ensureProductionBatchesForCreditBatches: mocks.ensureProduction,
}));
vi.mock("./storage-locations", () => ({
  ensureStorageLocation: mocks.ensureStorage,
}));
vi.mock("./registry-create", () => ({
  supplierRefLookup: (
    result: { found: true; externalId: string } | { found: false },
  ) =>
    result.found
      ? { found: "single" as const, externalId: result.externalId }
      : { found: "none" as const },
  performRegistryCreate: vi.fn(async (args: PerformRegistryCreateArgs) => {
    const reconciled = await args.reconcile();
    if (reconciled.found === "refused") throw new Error(reconciled.message);
    const externalId =
      reconciled.found === "single"
        ? reconciled.externalId
        : await args.create();
    await args.onConfirmed?.(externalId);
    return {
      externalId,
      source: reconciled.found === "single" ? "reconciliation" : "create",
    };
  }),
}));

import { ensureRemovalBiocharApplications } from "./biochar-applications";

const APPLICATION_ID = "11111111-1111-4111-8111-111111111111";
const CREDIT_BATCH_ID = "22222222-2222-4222-8222-222222222222";
const EXTERNAL_REMOVAL_ID = "ghg-test";
const orgCtx: OrgContext = {
  organizationId: "org-test",
  userId: "user-test",
  orgRole: "admin",
  isPlatformAdmin: false,
};
const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

function intent(): BiocharApplicationIntent {
  return {
    applicationId: APPLICATION_ID,
    applicationCode: "APP-001",
    creditBatchId: CREDIT_BATCH_ID,
    deliveryId: "delivery-1",
    customerLocationId: "33333333-3333-4333-8333-333333333333",
    certifierProjectId: "mapping-1",
    externalProjectId: "prj-test",
    applicationDate: "2026-04-05",
    allocatedWetMassKg: 12_000,
    fieldSizeHa: 4,
    supplierReference: "nm-isometric-sandbox-bca-app-batch-v1",
    storageLocationSupplierReference: "nm-slc-test",
    storageLocationPayload: {
      description: { __typename: "Undefined" },
      latitude: 46.948,
      longitude: 7.447,
      name: "North Field",
      project_id: "prj-test",
      storage_method: "biochar_field",
      supplier_reference_id: "nm-slc-test",
    },
    sourceIds: [],
  };
}

function registration(
  body: Record<string, unknown>,
  patch: Partial<CertifierBiocharApplication> = {},
): CertifierBiocharApplication {
  return {
    id: "journal-1",
    organizationId: orgCtx.organizationId,
    provider: "isometric",
    applicationId: APPLICATION_ID,
    creditBatchId: CREDIT_BATCH_ID,
    productionBatchRegistrationId: "production-journal-1",
    storageLocationRegistrationId: "storage-journal-1",
    externalProductionBatchId: "ptb-test",
    externalStorageLocationId: "slc-test",
    externalApplicationId: null,
    supplierReference: intent().supplierReference,
    submittedPayload: body as never,
    payloadHash: payloadHash(body),
    observedGhgEntryId: null,
    observedRemovalId: null,
    lifecycleStatus: "creating",
    correctionStatus: "none",
    driftReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...patch,
  };
}

function remote(
  patch: Partial<IsometricBiocharApplication> = {},
): IsometricBiocharApplication {
  return {
    id: "bca-test",
    application_date: "2026-04-05",
    average_application_rate: { magnitude: 3, unit: "t/ha" },
    production_batch_id: "ptb-test",
    storage_location_id: "slc-test",
    supplier_reference_id: intent().supplierReference,
    truck_mass_on_arrival: { magnitude: 12_000, unit: "kg" },
    truck_mass_on_departure: { magnitude: 0, unit: "kg" },
    ghg_entry_id: EXTERNAL_REMOVAL_ID,
    removal_id: null,
    uploaded_at: "2026-04-06T00:00:00Z",
    ...patch,
  };
}

function page(nodes: IsometricBiocharApplication[]) {
  return {
    nodes,
    page_info: { has_next_page: false, end_cursor: null },
    total_count: nodes.length,
  };
}

function ensure() {
  return ensureRemovalBiocharApplications({
    orgCtx,
    removalId: "removal-1",
    externalRemovalId: EXTERNAL_REMOVAL_ID,
    submissionRow: { id: "submission-1" } as CertificationSubmissionRow,
    intents: [intent()],
    log,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.registration = null;
  mocks.events.length = 0;
  mocks.getRegistration.mockImplementation(async () => mocks.registration);
  mocks.claim.mockImplementation(async (_ctx, input) => {
    mocks.registration = registration(input.submittedPayload);
    return mocks.registration;
  });
  mocks.confirm.mockImplementation(async (_ctx, input) => {
    mocks.events.push("biochar-confirmed");
    mocks.registration = {
      ...mocks.registration!,
      externalApplicationId: input.externalApplicationId,
      lifecycleStatus: "confirmed",
      correctionStatus: "none",
      driftReason: null,
      observedGhgEntryId: input.observedGhgEntryId,
      observedRemovalId: input.observedRemovalId,
    };
    return mocks.registration;
  });
  mocks.getProductionRegistrations.mockResolvedValue([
    {
      id: "production-journal-1",
      creditBatchId: CREDIT_BATCH_ID,
      externalProductionBatchId: "ptb-test",
    },
  ]);
  mocks.ensureProduction.mockImplementation(async () => {
    mocks.events.push("production-batch");
    return new Map([[CREDIT_BATCH_ID, "ptb-test"]]);
  });
  mocks.ensureStorage.mockImplementation(async () => {
    mocks.events.push("storage-location");
    return {
      externalStorageLocationId: "slc-test",
      drifted: false,
      registration: { id: "storage-journal-1" },
    };
  });
});

describe("ensureRemovalBiocharApplications", () => {
  it("orders Production Batch, Storage Location, then Biochar Application", async () => {
    mocks.client.get.mockResolvedValue(page([]));
    mocks.client.post.mockImplementation(async () => {
      mocks.events.push("biochar-application");
      return remote();
    });

    await ensure();

    expect(mocks.events).toEqual([
      "production-batch",
      "storage-location",
      "biochar-application",
      "biochar-confirmed",
    ]);
    expect(mocks.client.post).toHaveBeenCalledWith(
      "/biochar_applications",
      expect.objectContaining({
        truck_mass_on_arrival: { magnitude: 12_000, unit: "kg" },
        truck_mass_on_departure: { magnitude: 0, unit: "kg" },
      }),
    );
  });

  it("blocks on a registry failure and reconciles safely on retry", async () => {
    mocks.client.get
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(page([remote()]));
    mocks.client.post.mockRejectedValueOnce(new Error("connection reset"));

    await expect(ensure()).rejects.toThrow("connection reset");
    expect(mocks.registration).toMatchObject({ lifecycleStatus: "creating" });

    await expect(ensure()).resolves.toBeUndefined();
    expect(mocks.client.post).toHaveBeenCalledTimes(1);
    expect(mocks.registration).toMatchObject({
      lifecycleStatus: "confirmed",
      externalApplicationId: "bca-test",
    });
  });

  it("uses the ordinary claim path without a gated placeholder", async () => {
    mocks.client.get.mockResolvedValue(page([]));
    mocks.client.post.mockResolvedValue(remote());

    await ensure();

    expect(mocks.claim).toHaveBeenCalledOnce();
    expect(mocks.registration).toMatchObject({
      lifecycleStatus: "confirmed",
      driftReason: null,
    });
  });

  it("marks remote payload drift and does not duplicate the POST", async () => {
    const body = {
      application_date: "2026-04-05",
      average_application_rate: { magnitude: 3, unit: "t/ha" },
      production_batch_id: "ptb-test",
      project_id: "prj-test",
      source_ids: [],
      storage_site_id: "slc-test",
      supplier_reference_id: intent().supplierReference,
      truck_mass_on_arrival: { magnitude: 12_000, unit: "kg" },
      truck_mass_on_departure: { magnitude: 0, unit: "kg" },
    };
    mocks.registration = registration(body);
    mocks.client.get.mockResolvedValue(
      page([remote({ production_batch_id: "ptb-other" })]),
    );

    await expect(ensure()).rejects.toThrow(/does not match/i);
    expect(mocks.markDrift).toHaveBeenCalledWith(
      orgCtx,
      "journal-1",
      "remote_payload_or_identity_drift",
    );
    expect(mocks.client.post).not.toHaveBeenCalled();
  });
});
