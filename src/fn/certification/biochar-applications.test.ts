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
  env: { ISOMETRIC_ENVIRONMENT: "sandbox" as "sandbox" | "production" },
  registration: null as CertifierBiocharApplication | null,
  events: [] as string[],
  getRegistration: vi.fn(),
  claim: vi.fn(),
  confirm: vi.fn(),
  markDrift: vi.fn(),
  recordGated: vi.fn(),
  activateGated: vi.fn(),
  getProductionRegistrations: vi.fn(),
  ensureProduction: vi.fn(),
  ensureStorage: vi.fn(),
  withLock: vi.fn(async (_key: string, fn: () => Promise<unknown>) => fn()),
  client: { get: vi.fn(), post: vi.fn() },
}));

vi.mock("@/config/env", () => ({ env: mocks.env }));
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
  recordGatedBiocharApplicationRegistration: mocks.recordGated,
  activateGatedBiocharApplicationRegistration: mocks.activateGated,
}));
vi.mock("@/data-access/certifier-production-batches", () => ({
  getProductionBatchRegistrations: mocks.getProductionRegistrations,
}));
vi.mock("@/db", () => ({
  withDedicatedSessionAdvisoryLock: mocks.withLock,
}));
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
    if (reconciled.found === "single") {
      await args.onConfirmed?.(reconciled.externalId);
      return {
        externalId: reconciled.externalId,
        source: "reconciliation" as const,
      };
    }
    const externalId = await args.create();
    await args.onConfirmed?.(externalId);
    return { externalId, source: "create" as const };
  }),
}));

import { ensureRemovalBiocharApplications } from "./biochar-applications";
import type { GatedBiocharApplicationIntent } from "./biochar-application-intents";

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
    appliedTonnes: 12,
    fieldSizeHa: 4,
    gateReason: null,
    truckMassOnArrivalKg: 15_000,
    truckMassOnDepartureKg: 3_000,
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

function gatedIntent(): GatedBiocharApplicationIntent {
  return {
    ...intent(),
    gateReason: "missing_truck_masses",
    truckMassOnArrivalKg: null,
    truckMassOnDepartureKg: null,
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
    observedGhgEntryId: EXTERNAL_REMOVAL_ID,
    observedRemovalId: null,
    lifecycleStatus: "gated",
    correctionStatus: "none",
    gateReason: "create_in_flight",
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
    truck_mass_on_arrival: { magnitude: 15_000, unit: "kg" },
    truck_mass_on_departure: { magnitude: 3_000, unit: "kg" },
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
  mocks.env.ISOMETRIC_ENVIRONMENT = "sandbox";
  mocks.registration = null;
  mocks.events.length = 0;
  mocks.getRegistration.mockImplementation(async () => mocks.registration);
  mocks.claim.mockImplementation(async (_ctx, input) => {
    mocks.registration = registration(input.submittedPayload, {
      observedGhgEntryId: input.observedGhgEntryId,
      observedRemovalId: input.observedRemovalId,
    });
    return mocks.registration;
  });
  mocks.confirm.mockImplementation(async (_ctx, input) => {
    mocks.events.push("biochar-confirmed");
    mocks.registration = {
      ...mocks.registration!,
      externalApplicationId: input.externalApplicationId,
      lifecycleStatus: "confirmed",
      correctionStatus: "none",
      gateReason: null,
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

    expect(mocks.ensureStorage).toHaveBeenCalledWith(
      expect.objectContaining({
        expected: expect.objectContaining({
          customerLocationId: intent().customerLocationId,
          supplierReference: intent().storageLocationSupplierReference,
          payload: intent().storageLocationPayload,
        }),
      }),
    );

    expect(mocks.events).toEqual([
      "production-batch",
      "storage-location",
      "biochar-application",
      "biochar-confirmed",
    ]);
    expect(mocks.client.post).toHaveBeenCalledWith(
      "/biochar_applications",
      expect.objectContaining({
        average_application_rate: { magnitude: 3, unit: "t/ha" },
        production_batch_id: "ptb-test",
        storage_site_id: "slc-test",
        truck_mass_on_arrival: { magnitude: 15_000, unit: "kg" },
        truck_mass_on_departure: { magnitude: 3_000, unit: "kg" },
      }),
    );
  });

  it("journals a gated registration and skips the registry POST for missing truck masses", async () => {
    await ensureRemovalBiocharApplications({
      orgCtx,
      removalId: "removal-1",
      externalRemovalId: EXTERNAL_REMOVAL_ID,
      submissionRow: { id: "submission-1" } as CertificationSubmissionRow,
      intents: [gatedIntent()],
      log,
    });

    expect(mocks.ensureProduction).toHaveBeenCalledOnce();
    expect(mocks.ensureStorage).toHaveBeenCalledOnce();
    expect(mocks.recordGated).toHaveBeenCalledWith(
      orgCtx,
      expect.objectContaining({
        applicationId: APPLICATION_ID,
        creditBatchId: CREDIT_BATCH_ID,
        productionBatchRegistrationId: "production-journal-1",
        storageLocationRegistrationId: "storage-journal-1",
        externalProductionBatchId: "ptb-test",
        externalStorageLocationId: "slc-test",
        supplierReference: intent().supplierReference,
        gateReason: "missing_truck_masses",
      }),
    );
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.client.get).not.toHaveBeenCalled();
    expect(mocks.client.post).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it("upgrades a mass-gated placeholder into the in-flight claim once masses exist", async () => {
    mocks.registration = registration(
      {},
      {
        submittedPayload: null,
        payloadHash: null,
        gateReason: "missing_truck_masses",
        observedGhgEntryId: null,
      },
    );
    mocks.activateGated.mockImplementation(async (_ctx, input) => {
      mocks.events.push("gated-activated");
      mocks.registration = {
        ...mocks.registration!,
        submittedPayload: input.submittedPayload,
        payloadHash: input.payloadHash,
        gateReason: "create_in_flight",
      };
      return mocks.registration;
    });
    mocks.client.get.mockResolvedValue(page([]));
    mocks.client.post.mockImplementation(async () => {
      mocks.events.push("biochar-application");
      return remote();
    });

    await ensure();

    expect(mocks.activateGated).toHaveBeenCalledWith(
      orgCtx,
      expect.objectContaining({
        registrationId: "journal-1",
        applicationId: APPLICATION_ID,
        creditBatchId: CREDIT_BATCH_ID,
        supplierReference: intent().supplierReference,
      }),
    );
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.markDrift).not.toHaveBeenCalled();
    expect(mocks.events).toContain("gated-activated");
    expect(mocks.registration).toMatchObject({
      lifecycleStatus: "confirmed",
      externalApplicationId: "bca-test",
      gateReason: null,
    });
  });

  it("reconciles an ambiguous POST on retry without posting a duplicate", async () => {
    mocks.client.get
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(page([remote()]));
    mocks.client.post.mockRejectedValueOnce(new Error("connection reset"));

    await expect(ensure()).rejects.toThrow("connection reset");
    expect(mocks.registration).toMatchObject({
      lifecycleStatus: "gated",
      observedGhgEntryId: null,
      observedRemovalId: null,
    });

    await expect(ensure()).resolves.toBeUndefined();
    expect(mocks.client.post).toHaveBeenCalledTimes(1);
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(mocks.registration).toMatchObject({
      lifecycleStatus: "confirmed",
      externalApplicationId: "bca-test",
      observedGhgEntryId: EXTERNAL_REMOVAL_ID,
    });
  });

  it("keeps the pre-POST claim unobserved after a registry refusal", async () => {
    mocks.client.get.mockResolvedValue(page([]));
    mocks.client.post.mockRejectedValue(new Error("registry refused request"));

    await expect(ensure()).rejects.toThrow("registry refused request");
    expect(mocks.registration).toMatchObject({
      lifecycleStatus: "gated",
      observedGhgEntryId: null,
      observedRemovalId: null,
    });
  });

  it("reuses a confirmed application across a superseding Removal version", async () => {
    mocks.client.get.mockResolvedValue(page([]));
    mocks.client.post.mockResolvedValue(remote());
    await ensure();

    vi.clearAllMocks();
    mocks.client.get.mockResolvedValue(page([remote()]));
    await ensureRemovalBiocharApplications({
      orgCtx,
      removalId: "removal-1",
      externalRemovalId: "ghg-superseding-version",
      submissionRow: { id: "submission-2" } as CertificationSubmissionRow,
      intents: [intent()],
      log,
    });

    expect(mocks.client.post).not.toHaveBeenCalled();
    expect(mocks.registration).toMatchObject({
      lifecycleStatus: "confirmed",
      externalApplicationId: "bca-test",
      observedGhgEntryId: EXTERNAL_REMOVAL_ID,
    });
  });

  it("rejects remote payload drift without POSTing", async () => {
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

  it("does not confirm an unobserved GHG Entry association", async () => {
    mocks.client.get.mockResolvedValue(
      page([remote({ ghg_entry_id: null, removal_id: null })]),
    );

    await expect(ensure()).rejects.toThrow(/not linked to a GHG Entry yet/i);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it("preserves the confirmed external identity when reconciliation finds another record", async () => {
    mocks.client.get.mockResolvedValue(page([]));
    mocks.client.post.mockResolvedValue(remote());
    await ensure();

    vi.clearAllMocks();
    mocks.client.get.mockResolvedValue(
      page([remote({ id: "bca-replacement" })]),
    );

    await expect(ensure()).rejects.toThrow(/different Biochar Application identity/i);
    expect(mocks.markDrift).toHaveBeenCalledWith(
      orgCtx,
      "journal-1",
      "external_identity_drift",
    );
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.registration?.externalApplicationId).toBe("bca-test");
  });

  it("rejects journal payload drift before any Biochar Application lookup or POST", async () => {
    mocks.registration = registration({}, { payloadHash: "stale" });

    await expect(ensure()).rejects.toThrow(/journal drift/i);
    expect(mocks.markDrift).toHaveBeenCalledWith(
      orgCtx,
      "journal-1",
      "local_payload_or_dependency_drift",
    );
    expect(mocks.client.get).not.toHaveBeenCalled();
    expect(mocks.client.post).not.toHaveBeenCalled();
  });

  it("keeps the integration fail-closed in production", async () => {
    mocks.env.ISOMETRIC_ENVIRONMENT = "production";
    await expect(ensure()).rejects.toThrow(/not enabled for production/i);
    expect(mocks.ensureProduction).not.toHaveBeenCalled();
    expect(mocks.ensureStorage).not.toHaveBeenCalled();
  });
});
