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

function intent(
  patch: Partial<BiocharApplicationIntent> = {},
): BiocharApplicationIntent {
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
    ...patch,
  };
}

function submittedBody(): Record<string, unknown> {
  return {
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
    removalSubmissionId: "submission-1",
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

function canonicalRemote(
  patch: Partial<IsometricBiocharApplication> = {},
): IsometricBiocharApplication {
  return remote({
    average_application_rate: {
      magnitude: 3,
      unit: "metric_ton / hectare",
    },
    truck_mass_on_arrival: { magnitude: 12_000, unit: "kilogram" },
    truck_mass_on_departure: { magnitude: 0, unit: "kilogram" },
    ...patch,
  });
}

function page(nodes: IsometricBiocharApplication[]) {
  return {
    nodes,
    page_info: { has_next_page: false, end_cursor: null },
    total_count: nodes.length,
  };
}

function ensure(intents: BiocharApplicationIntent[] = [intent()]) {
  return ensureRemovalBiocharApplications({
    orgCtx,
    removalId: "removal-1",
    externalRemovalId: EXTERNAL_REMOVAL_ID,
    submissionRow: { id: "submission-1" } as CertificationSubmissionRow,
    intents,
    log,
  });
}

function ensureVersion(args: {
  submissionId: string;
  externalRemovalId: string;
  intent: BiocharApplicationIntent;
}) {
  return ensureRemovalBiocharApplications({
    orgCtx,
    removalId: "removal-1",
    externalRemovalId: args.externalRemovalId,
    submissionRow: { id: args.submissionId } as CertificationSubmissionRow,
    intents: [args.intent],
    log,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.registration = null;
  mocks.events.length = 0;
  mocks.getRegistration.mockImplementation(async () => mocks.registration);
  mocks.claim.mockImplementation(async (_ctx, input) => {
    mocks.registration = registration(input.submittedPayload, {
      removalSubmissionId: input.removalSubmissionId,
      supplierReference: input.supplierReference,
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
  it("accepts canonical units on immediate POST readback after its dependencies", async () => {
    mocks.client.get.mockResolvedValue(page([]));
    mocks.client.post.mockImplementation(async () => {
      mocks.events.push("biochar-application");
      return canonicalRemote();
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
    expect(mocks.client.post).toHaveBeenCalledTimes(1);
  });

  it("accepts a matching Biochar Application when Isometric leaves its optional GHG Entry association empty", async () => {
    const unlinkedRemote = canonicalRemote({
      ghg_entry_id: null,
      removal_id: null,
    });
    mocks.client.get.mockResolvedValue(page([]));
    mocks.client.post.mockResolvedValue(unlinkedRemote);

    await expect(ensure()).resolves.toBeUndefined();

    expect(mocks.client.post).toHaveBeenCalledTimes(1);
    expect(mocks.confirm).toHaveBeenCalledWith(
      orgCtx,
      expect.objectContaining({
        externalApplicationId: "bca-test",
        observedGhgEntryId: null,
        observedRemovalId: null,
      }),
    );
    expect(
      mocks.client.get.mock.calls.every(
        ([path]) => path === "/biochar_applications",
      ),
    ).toBe(true);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: APPLICATION_ID,
        creditBatchId: CREDIT_BATCH_ID,
        removalId: "removal-1",
        submissionId: "submission-1",
        externalApplicationId: "bca-test",
        externalRemovalId: EXTERNAL_REMOVAL_ID,
      }),
      "Biochar Application has no registry GHG Entry association; accepting the provider-null readback",
    );
  });

  it("reconciles an existing matching Biochar Application with no GHG Entry association", async () => {
    const unlinkedRemote = canonicalRemote({
      ghg_entry_id: null,
      removal_id: null,
    });
    mocks.client.get.mockResolvedValue(page([unlinkedRemote]));

    await expect(ensure()).resolves.toBeUndefined();

    expect(mocks.client.post).not.toHaveBeenCalled();
    expect(mocks.markDrift).not.toHaveBeenCalled();
    expect(mocks.confirm).toHaveBeenCalledWith(
      orgCtx,
      expect.objectContaining({
        externalApplicationId: "bca-test",
        observedGhgEntryId: null,
        observedRemovalId: null,
      }),
    );
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: APPLICATION_ID,
        submissionId: "submission-1",
        externalApplicationId: "bca-test",
      }),
      "Biochar Application has no registry GHG Entry association; accepting the provider-null readback",
    );
  });

  it("reconciles canonical units on retry without a duplicate POST", async () => {
    mocks.client.get
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(page([canonicalRemote()]));
    mocks.client.post.mockRejectedValueOnce(new Error("connection reset"));

    await expect(ensure()).rejects.toThrow("connection reset");
    expect(mocks.registration).toMatchObject({ lifecycleStatus: "creating" });

    await expect(ensure()).resolves.toBeUndefined();
    expect(mocks.client.post).toHaveBeenCalledTimes(1);
    expect(mocks.registration).toMatchObject({
      lifecycleStatus: "confirmed",
      externalApplicationId: "bca-test",
    });
    expect(
      mocks.client.get.mock.calls.every(
        ([path]) => path === "/biochar_applications",
      ),
    ).toBe(true);
  });

  it("reads a confirmed identity directly and accepts its current Removal association", async () => {
    mocks.registration = registration(submittedBody(), {
      externalApplicationId: "bca-test",
      lifecycleStatus: "confirmed",
      observedGhgEntryId: "ghg-previous",
    });
    mocks.client.get.mockImplementation(async (path: string) => {
      if (path === "/biochar_applications/bca-test") {
        return canonicalRemote();
      }
      throw new Error("confirmed retry must not scan the account-wide list");
    });

    await expect(ensure()).resolves.toBeUndefined();

    expect(mocks.client.get).toHaveBeenCalledOnce();
    expect(mocks.client.get).toHaveBeenCalledWith(
      "/biochar_applications/bca-test",
    );
    expect(mocks.client.post).not.toHaveBeenCalled();
    expect(mocks.confirm).toHaveBeenCalledWith(
      orgCtx,
      expect.objectContaining({ observedGhgEntryId: EXTERNAL_REMOVAL_ID }),
    );
  });

  it("retains prior non-null association observations when confirmed readback is null", async () => {
    mocks.registration = registration(submittedBody(), {
      externalApplicationId: "bca-test",
      lifecycleStatus: "confirmed",
      observedGhgEntryId: EXTERNAL_REMOVAL_ID,
      observedRemovalId: EXTERNAL_REMOVAL_ID,
    });
    mocks.client.get.mockResolvedValue(
      canonicalRemote({ ghg_entry_id: null, removal_id: null }),
    );

    await expect(ensure()).resolves.toBeUndefined();

    expect(mocks.confirm).toHaveBeenCalledWith(
      orgCtx,
      expect.objectContaining({
        observedGhgEntryId: EXTERNAL_REMOVAL_ID,
        observedRemovalId: EXTERNAL_REMOVAL_ID,
      }),
    );
    expect(mocks.registration).toMatchObject({
      observedGhgEntryId: EXTERNAL_REMOVAL_ID,
      observedRemovalId: EXTERNAL_REMOVAL_ID,
    });
  });

  it("rejects a deprecated Removal association to a different GHG Entry when the current field is null", async () => {
    mocks.client.get.mockResolvedValue(
      page([
        canonicalRemote({
          ghg_entry_id: null,
          removal_id: "ghg-previous",
        }),
      ]),
    );

    await expect(ensure()).rejects.toThrow(/different GHG Entry/i);

    expect(mocks.markDrift).toHaveBeenCalledWith(
      orgCtx,
      "journal-1",
      "remote_payload_or_identity_drift",
    );
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("rejects a confirmed identity still associated with the superseded Removal", async () => {
    mocks.registration = registration(submittedBody(), {
      externalApplicationId: "bca-test",
      lifecycleStatus: "confirmed",
      observedGhgEntryId: "ghg-previous",
    });
    mocks.client.get.mockResolvedValue(
      canonicalRemote({ ghg_entry_id: "ghg-previous" }),
    );

    await expect(ensure()).rejects.toThrow(/different GHG Entry/i);

    expect(mocks.markDrift).toHaveBeenCalledWith(
      orgCtx,
      "journal-1",
      "remote_payload_or_identity_drift",
    );
    expect(mocks.client.post).not.toHaveBeenCalled();
  });

  it("creates one versioned Biochar Application per superseding Removal and reuses v2", async () => {
    const firstIntent = intent();
    const secondIntent = intent({
      supplierReference: "nm-isometric-sandbox-bca-app-batch-s2-v1",
    });
    const registrations = new Map<string, CertifierBiocharApplication>();
    mocks.getRegistration.mockImplementation(
      async (_ctx, _applicationId, _creditBatchId, removalSubmissionId) =>
        registrations.get(removalSubmissionId) ?? null,
    );
    mocks.claim.mockImplementation(async (_ctx, input) => {
      const row = registration(input.submittedPayload, {
        id: `journal-${input.removalSubmissionId}`,
        removalSubmissionId: input.removalSubmissionId,
        supplierReference: input.supplierReference,
      });
      registrations.set(input.removalSubmissionId, row);
      return row;
    });
    mocks.confirm.mockImplementation(async (_ctx, input) => {
      const entry = [...registrations.entries()].find(
        ([, row]) => row.id === input.registrationId,
      );
      if (!entry) throw new Error("registration not found");
      const [submissionId, row] = entry;
      registrations.set(submissionId, {
        ...row,
        externalApplicationId: input.externalApplicationId,
        lifecycleStatus: "confirmed",
        observedGhgEntryId: input.observedGhgEntryId,
        observedRemovalId: input.observedRemovalId,
      });
      return registrations.get(submissionId)!;
    });

    const firstRemote = canonicalRemote({
      id: "bca-v1",
      ghg_entry_id: "ghg-v1",
      supplier_reference_id: firstIntent.supplierReference,
    });
    const secondRemote = canonicalRemote({
      id: "bca-v2",
      ghg_entry_id: "ghg-v2",
      supplier_reference_id: secondIntent.supplierReference,
    });
    mocks.client.get.mockImplementation(async (path: string) => {
      if (path === "/biochar_applications/bca-v1") return firstRemote;
      if (path === "/biochar_applications/bca-v2") return secondRemote;
      return page([]);
    });
    mocks.client.post.mockImplementation(async (_path, body) => {
      const supplierReference = (
        body as { supplier_reference_id: string }
      ).supplier_reference_id;
      return supplierReference === firstIntent.supplierReference
        ? firstRemote
        : secondRemote;
    });

    await ensureVersion({
      submissionId: "submission-v1",
      externalRemovalId: "ghg-v1",
      intent: firstIntent,
    });
    await ensureVersion({
      submissionId: "submission-v2",
      externalRemovalId: "ghg-v2",
      intent: secondIntent,
    });
    await ensureVersion({
      submissionId: "submission-v2",
      externalRemovalId: "ghg-v2",
      intent: secondIntent,
    });

    expect(mocks.client.post).toHaveBeenCalledTimes(2);
    expect(registrations.get("submission-v1")).toMatchObject({
      externalApplicationId: "bca-v1",
      observedGhgEntryId: "ghg-v1",
    });
    expect(registrations.get("submission-v2")).toMatchObject({
      externalApplicationId: "bca-v2",
      observedGhgEntryId: "ghg-v2",
    });
  });

  it("reuses the first of two applications, creates only the missing second, and makes no writes on another retry", async () => {
    const secondIntent = intent({
      applicationId: "44444444-4444-4444-8444-444444444444",
      applicationCode: "APP-002",
      deliveryId: "delivery-2",
      customerLocationId: "55555555-5555-4555-8555-555555555555",
      allocatedWetMassKg: 6_000,
      fieldSizeHa: 2,
      supplierReference: "nm-isometric-sandbox-bca-app-2-batch-v1",
      storageLocationSupplierReference: "nm-slc-test-2",
    });
    const intents = [intent(), secondIntent];
    const registrations = new Map<string, CertifierBiocharApplication>();
    const key = (applicationId: string, creditBatchId: string) =>
      `${applicationId}:${creditBatchId}`;

    mocks.getRegistration.mockImplementation(
      async (_ctx, applicationId, creditBatchId) =>
        registrations.get(key(applicationId, creditBatchId)) ?? null,
    );
    mocks.claim.mockImplementation(async (_ctx, input) => {
      const row = registration(input.submittedPayload, {
        id: `journal-${input.applicationId}`,
        applicationId: input.applicationId,
        creditBatchId: input.creditBatchId,
        supplierReference: input.supplierReference,
      });
      registrations.set(key(input.applicationId, input.creditBatchId), row);
      return row;
    });
    mocks.confirm.mockImplementation(async (_ctx, input) => {
      const entry = [...registrations.entries()].find(
        ([, row]) => row.id === input.registrationId,
      );
      if (!entry) throw new Error("registration not found");
      const [registrationKey, row] = entry;
      registrations.set(registrationKey, {
        ...row,
        externalApplicationId: input.externalApplicationId,
        lifecycleStatus: "confirmed",
        correctionStatus: "none",
        driftReason: null,
        observedGhgEntryId: input.observedGhgEntryId,
        observedRemovalId: input.observedRemovalId,
      });
      return registrations.get(registrationKey)!;
    });

    const firstRemote = canonicalRemote();
    const secondRemote = canonicalRemote({
      id: "bca-test-2",
      supplier_reference_id: secondIntent.supplierReference,
      truck_mass_on_arrival: { magnitude: 6_000, unit: "kilogram" },
    });
    mocks.client.get.mockResolvedValue(page([firstRemote]));
    mocks.client.post.mockResolvedValue(secondRemote);

    await ensure(intents);

    expect(mocks.client.post).toHaveBeenCalledTimes(1);
    expect(mocks.client.post).toHaveBeenCalledWith(
      "/biochar_applications",
      expect.objectContaining({
        supplier_reference_id: secondIntent.supplierReference,
      }),
    );
    expect([...registrations.values()]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ externalApplicationId: "bca-test" }),
        expect.objectContaining({ externalApplicationId: "bca-test-2" }),
      ]),
    );

    mocks.client.get.mockImplementation(async (path: string) => {
      if (path === "/biochar_applications/bca-test") return firstRemote;
      if (path === "/biochar_applications/bca-test-2") return secondRemote;
      return page([firstRemote, secondRemote]);
    });
    await ensure(intents);

    expect(mocks.client.post).toHaveBeenCalledTimes(1);
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
