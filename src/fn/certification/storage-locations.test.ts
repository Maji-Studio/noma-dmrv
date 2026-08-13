import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageLocationRegistryInput } from "@/data-access/certifier-storage-locations";
import type { CertifierStorageLocation } from "@/db/schema/certifier-storage-locations";
import type { OrgContext } from "@/lib/auth/server";
import type { Logger } from "@/lib/log";
import type { PerformRegistryCreateArgs } from "./registry-create";

const mocks = vi.hoisted(() => ({
  env: { ISOMETRIC_ENVIRONMENT: "sandbox" as "sandbox" | "production" },
  getInput: vi.fn(),
  getRegistration: vi.fn(),
  persistRegistration: vi.fn(),
  setDrift: vi.fn(),
  appendEvent: vi.fn(),
  requireOrgRole: vi.fn(),
  withLock: vi.fn(async (_key: string, fn: () => Promise<unknown>) => fn()),
  client: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

vi.mock("@/config/env", () => ({ env: mocks.env }));

vi.mock("@/data-access/certifier-storage-locations", () => ({
  getStorageLocationRegistryInput: mocks.getInput,
  getStorageLocationRegistration: mocks.getRegistration,
  persistStorageLocationRegistration: mocks.persistRegistration,
  setStorageLocationDrift: mocks.setDrift,
}));
vi.mock("@/lib/isometric/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/isometric/client")>()),
  getIsometricClientForOrg: vi.fn(async () => mocks.client),
}));
vi.mock("@/db", () => ({
  withDedicatedSessionAdvisoryLock: mocks.withLock,
}));
vi.mock("@/lib/auth/server", () => ({
  requireOrgRole: mocks.requireOrgRole,
}));
vi.mock("./shared", () => ({
  appendSyncEventBestEffort: mocks.appendEvent,
  ISOMETRIC_PROVIDER: "isometric",
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
    if (reconciled.found === "single") {
      await args.onConfirmed?.(reconciled.externalId);
      return { externalId: reconciled.externalId, source: "reconciliation" as const };
    }
    if (reconciled.found === "refused") throw new Error(reconciled.message);
    const externalId = await args.create();
    await args.onConfirmed?.(externalId);
    return { externalId, source: "create" as const };
  }),
}));

import { ensureStorageLocation } from "./storage-locations";
import { performRegistryCreate } from "./registry-create";

const CUSTOMER_LOCATION_ID = "11111111-1111-4111-8111-111111111111";
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

function input(
  patch: Partial<StorageLocationRegistryInput> = {},
): StorageLocationRegistryInput {
  return {
    applicationId: "app-1",
    facilityId: "facility-1",
    customerLocationId: CUSTOMER_LOCATION_ID,
    certifierProjectId: "mapping-1",
    externalProjectId: "prj-test",
    name: "North Field",
    latitude: -3.25,
    longitude: 37.42,
    ...patch,
  };
}

function registration(
  patch: Partial<CertifierStorageLocation> = {},
): CertifierStorageLocation {
  return {
    id: "registration-1",
    organizationId: orgCtx.organizationId,
    provider: "isometric",
    customerLocationId: CUSTOMER_LOCATION_ID,
    certifierProjectId: "mapping-1",
    externalProjectId: "prj-test",
    externalStorageLocationId: "slc-test",
    supplierReference: "nm-slc-placeholder",
    submittedPayload: {
      description: { __typename: "Undefined" },
      latitude: -3.25,
      longitude: 37.42,
      name: "North Field",
      project_id: "prj-test",
      storage_method: "biochar_field",
      supplier_reference_id: "nm-slc-placeholder",
    },
    payloadHash: "hash",
    driftStatus: "in_sync",
    driftDetails: null,
    driftDetectedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...patch,
  };
}

function remote(supplierReference: string, id = "slc-test") {
  return {
    id,
    latitude: -3.25,
    longitude: 37.42,
    name: "North Field",
    project_id: "prj-test",
    storage_method: "biochar_field" as const,
    supplier_id: "spl-test",
    supplier_reference_id: supplierReference,
  };
}

function ensure() {
  return ensureStorageLocation({
    orgCtx,
    applicationId: "app-1",
    log,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.ISOMETRIC_ENVIRONMENT = "sandbox";
  mocks.withLock.mockImplementation(
    async (_key: string, fn: () => Promise<unknown>) => fn(),
  );
  mocks.requireOrgRole.mockReturnValue(undefined);
  mocks.getInput.mockResolvedValue(input());
  mocks.getRegistration.mockResolvedValue(null);
  mocks.setDrift.mockResolvedValue(undefined);
  mocks.appendEvent.mockResolvedValue(undefined);
  mocks.client.get.mockImplementation(async (path: string) =>
    path.endsWith("/slc-test")
      ? remote("nm-slc-placeholder")
      : {
          nodes: [],
          page_info: {
            end_cursor: null,
            has_next_page: false,
            has_previous_page: false,
            start_cursor: null,
          },
          total_count: 0,
        },
  );
  mocks.client.post.mockImplementation(async (_path: string, body: { supplier_reference_id: string }) =>
    remote(body.supplier_reference_id),
  );
  mocks.persistRegistration.mockImplementation(
    async (_ctx: unknown, value: { externalStorageLocationId: string; supplierReference: string; submittedPayload: unknown; payloadHash: string }) =>
      registration({
        externalStorageLocationId: value.externalStorageLocationId,
        supplierReference: value.supplierReference,
        submittedPayload: value.submittedPayload as never,
        payloadHash: value.payloadHash,
      }),
  );
});

describe("ensureStorageLocation", () => {
  it("requires an administrator before reading or synchronizing a site", async () => {
    mocks.requireOrgRole.mockImplementationOnce(() => {
      throw new Error("admin required");
    });

    await expect(ensure()).rejects.toThrow("admin required");
    expect(mocks.getInput).not.toHaveBeenCalled();
  });

  it("reconciles by stable reference before POSTing and creates only when absent", async () => {
    const result = await ensure();
    expect(performRegistryCreate).toHaveBeenCalledWith(
      expect.objectContaining({ resumed: true }),
    );
    expect(mocks.client.get.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.client.post.mock.invocationCallOrder[0],
    );
    expect(mocks.client.post).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      externalStorageLocationId: "slc-test",
      source: "create",
      drifted: false,
    });
  });

  it("claims a matching remote record without POSTing", async () => {
    const reference = (await import("@/lib/isometric/storage-locations")).buildStorageLocationReference({
      customerLocationId: CUSTOMER_LOCATION_ID,
      externalProjectId: "prj-test",
    });
    mocks.client.get.mockResolvedValue({
      nodes: [remote(reference)],
      page_info: {
        end_cursor: null,
        has_next_page: false,
        has_previous_page: false,
        start_cursor: null,
      },
      total_count: 1,
    });
    const result = await ensure();
    expect(mocks.client.post).not.toHaveBeenCalled();
    expect(result.source).toBe("reconciliation");
  });

  it("rechecks the journal under the site lock before registry access", async () => {
    mocks.getRegistration
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(registration({ payloadHash: expect.any(String) }));

    const result = await ensure();

    expect(mocks.withLock).toHaveBeenCalledWith(
      `certifier-storage-location:isometric:prj-test:${CUSTOMER_LOCATION_ID}`,
      expect.any(Function),
    );
    expect(mocks.client.get).toHaveBeenCalledTimes(1);
    expect(mocks.client.post).not.toHaveBeenCalled();
    expect(result.source).toBe("journal");
  });

  it("revalidates customer-location identity and facts under both locks before POSTing", async () => {
    mocks.getInput
      .mockResolvedValueOnce(input())
      .mockResolvedValueOnce(input({ name: "South Field" }));

    await expect(ensure()).rejects.toThrow(/application site changed/);

    expect(mocks.client.get).not.toHaveBeenCalled();
    expect(mocks.client.post).not.toHaveBeenCalled();
    expect(mocks.persistRegistration).not.toHaveBeenCalled();
  });

  it("serializes concurrent first syncs so only one caller can POST", async () => {
    const lockTails = new Map<string, Promise<void>>();
    mocks.withLock.mockImplementation(
      async (key: string, fn: () => Promise<unknown>) => {
        const previous = lockTails.get(key) ?? Promise.resolve();
        let release = () => {};
        const tail = new Promise<void>((resolve) => {
          release = resolve;
        });
        lockTails.set(key, tail);
        await previous;
        try {
          return await fn();
        } finally {
          release();
          if (lockTails.get(key) === tail) lockTails.delete(key);
        }
      },
    );
    let winner: CertifierStorageLocation | null = null;
    mocks.getRegistration.mockImplementation(async () => winner);
    mocks.persistRegistration.mockImplementation(
      async (
        _ctx: unknown,
        value: {
          externalStorageLocationId: string;
          supplierReference: string;
          submittedPayload: unknown;
          payloadHash: string;
        },
      ) => {
        winner = registration({
          externalStorageLocationId: value.externalStorageLocationId,
          supplierReference: value.supplierReference,
          submittedPayload: value.submittedPayload as never,
          payloadHash: value.payloadHash,
        });
        return winner;
      },
    );

    const [first, second] = await Promise.all([ensure(), ensure()]);

    expect(mocks.client.post).toHaveBeenCalledTimes(1);
    expect(first.externalStorageLocationId).toBe(second.externalStorageLocationId);
    expect([first.source, second.source].sort()).toEqual(["create", "journal"]);
  });

  it("adopts an orphaned remote identity and records changed site facts as drift", async () => {
    const reference = (await import("@/lib/isometric/storage-locations")).buildStorageLocationReference({
      customerLocationId: CUSTOMER_LOCATION_ID,
      externalProjectId: "prj-test",
    });
    mocks.client.get.mockResolvedValue({
      nodes: [{ ...remote(reference), latitude: -4.5 }],
      page_info: {
        end_cursor: null,
        has_next_page: false,
        has_previous_page: false,
        start_cursor: null,
      },
      total_count: 1,
    });
    const result = await ensure();

    expect(mocks.client.post).not.toHaveBeenCalled();
    expect(mocks.persistRegistration).toHaveBeenCalledWith(
      orgCtx,
      expect.objectContaining({ externalStorageLocationId: "slc-test" }),
    );
    expect(mocks.setDrift).toHaveBeenCalledWith(
      orgCtx,
      "registration-1",
      expect.objectContaining({
        status: "drifted",
        details: expect.objectContaining({
          remoteDriftReason: expect.stringMatching(/conflicts/),
        }),
      }),
    );
    expect(result).toMatchObject({ source: "reconciliation", drifted: true });
  });

  it("preserves a confirmed POST identity and marks provider-normalized facts as drift", async () => {
    mocks.client.post.mockImplementation(
      async (_path: string, body: { supplier_reference_id: string }) => ({
        ...remote(body.supplier_reference_id),
        latitude: -3.2,
      }),
    );

    const result = await ensure();

    expect(result).toMatchObject({
      externalStorageLocationId: "slc-test",
      source: "create",
      drifted: true,
    });
    expect(mocks.persistRegistration).toHaveBeenCalledWith(
      orgCtx,
      expect.objectContaining({ externalStorageLocationId: "slc-test" }),
    );
    expect(mocks.setDrift).toHaveBeenCalledWith(
      orgCtx,
      "registration-1",
      expect.objectContaining({
        status: "drifted",
        details: expect.objectContaining({
          remoteDriftReason: expect.stringMatching(/conflicts/),
        }),
      }),
    );
    expect(mocks.appendEvent).toHaveBeenCalledWith(
      orgCtx,
      expect.objectContaining({
        entityId: expect.stringMatching(/^nm-slc-/),
        responsePayload: expect.objectContaining({ id: "slc-test" }),
      }),
    );
  });

  it("reuses an existing identity and journals local coordinate drift", async () => {
    mocks.getRegistration.mockResolvedValue(registration());
    const result = await ensure();
    expect(mocks.client.get).toHaveBeenCalledTimes(1);
    expect(mocks.client.post).not.toHaveBeenCalled();
    expect(mocks.setDrift).toHaveBeenCalledWith(
      orgCtx,
      "registration-1",
      expect.objectContaining({ status: "drifted" }),
    );
    expect(mocks.appendEvent).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ source: "journal", drifted: true });
  });

  it("marks matching local and remote facts in sync", async () => {
    const {
      buildCreateStorageLocationRequest,
      buildStorageLocationReference,
    } = await import("@/lib/isometric/storage-locations");
    const { payloadHash } = await import("@/lib/isometric/utils/payload-hash");
    const supplierReference = buildStorageLocationReference({
      customerLocationId: CUSTOMER_LOCATION_ID,
      externalProjectId: "prj-test",
    });
    const submittedPayload = buildCreateStorageLocationRequest({
      externalProjectId: "prj-test",
      name: "North Field",
      latitude: -3.25,
      longitude: 37.42,
      supplierReferenceId: supplierReference,
    });
    mocks.getRegistration.mockResolvedValue(
      registration({
        supplierReference,
        submittedPayload,
        payloadHash: payloadHash(submittedPayload),
      }),
    );
    mocks.client.get.mockResolvedValue(remote(supplierReference));

    const result = await ensure();

    expect(result).toMatchObject({ source: "journal", drifted: false });
    expect(mocks.setDrift).toHaveBeenCalledWith(
      orgCtx,
      "registration-1",
      { status: "in_sync" },
    );
    expect(mocks.appendEvent).not.toHaveBeenCalled();
  });

  it("reuses an existing identity when mutable site facts become incomplete", async () => {
    mocks.getInput.mockResolvedValue(
      input({
        latitude: null,
      }),
    );
    mocks.getRegistration.mockResolvedValue(registration());

    const result = await ensure();

    expect(result).toMatchObject({ source: "journal", drifted: true });
    expect(mocks.setDrift).toHaveBeenCalledWith(
      orgCtx,
      "registration-1",
      expect.objectContaining({
        status: "drifted",
        details: expect.objectContaining({
          missingFacts: ["latitude"],
        }),
      }),
    );
    expect(mocks.client.get).toHaveBeenCalledTimes(1);
    expect(mocks.client.post).not.toHaveBeenCalled();
  });

  it("surfaces remote coordinate drift without patching the registry", async () => {
    mocks.getRegistration.mockResolvedValue(registration());
    mocks.client.get.mockResolvedValue({
      ...remote("nm-slc-placeholder"),
      latitude: -4.5,
    });

    const result = await ensure();

    expect(result.drifted).toBe(true);
    expect(mocks.setDrift).toHaveBeenCalledWith(
      orgCtx,
      "registration-1",
      expect.objectContaining({
        status: "drifted",
        details: expect.objectContaining({
          remoteDriftReason: expect.stringMatching(/conflicts/),
        }),
      }),
    );
    expect(mocks.client.patch).not.toHaveBeenCalled();
  });

  it("marks a deleted remote registration as drift without creating a replacement", async () => {
    const { IsometricApiError } = await import("@/lib/isometric/client");
    mocks.getRegistration.mockResolvedValue(registration());
    mocks.client.get.mockRejectedValue(
      new IsometricApiError("not found", 404, undefined, "http"),
    );

    const result = await ensure();

    expect(result).toMatchObject({ source: "journal", drifted: true });
    expect(mocks.setDrift).toHaveBeenCalledWith(
      orgCtx,
      "registration-1",
      expect.objectContaining({
        status: "drifted",
        details: expect.objectContaining({
          remoteDriftReason: expect.stringMatching(/no longer exists/),
        }),
      }),
    );
    expect(mocks.client.post).not.toHaveBeenCalled();
  });

  it("refuses production writes at the registry seam", async () => {
    mocks.env.ISOMETRIC_ENVIRONMENT = "production";

    await expect(ensure()).rejects.toThrow(/not enabled for production/);
    expect(mocks.getInput).not.toHaveBeenCalled();
    expect(mocks.client.post).not.toHaveBeenCalled();
  });

  it("fails loudly when a concurrent winner fixed a different identity", async () => {
    mocks.persistRegistration.mockResolvedValue(
      registration({
        externalStorageLocationId: "slc-other",
        supplierReference: "nm-slc-other",
      }),
    );
    await expect(ensure()).rejects.toThrow(/concurrently registered/);
  });

  it("fails closed before registry access when canonical coordinates are missing", async () => {
    mocks.getInput.mockResolvedValue(input({ latitude: null }));
    await expect(ensure()).rejects.toThrow(/latitude/);
    expect(mocks.client.get).not.toHaveBeenCalled();
    expect(mocks.client.post).not.toHaveBeenCalled();
  });
});
