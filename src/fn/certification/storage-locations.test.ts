import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageLocationRegistryInput } from "@/data-access/certifier-storage-locations";
import type { CertifierStorageLocation } from "@/db/schema/certifier-storage-locations";
import type { OrgContext } from "@/lib/auth/server";
import type { Logger } from "@/lib/log";

const mocks = vi.hoisted(() => ({
  env: { ISOMETRIC_ENVIRONMENT: "sandbox" as "sandbox" | "production" },
  getInput: vi.fn(),
  getRegistration: vi.fn(),
  persistRegistration: vi.fn(),
  replaceRegistration: vi.fn(),
  setDrift: vi.fn(),
  appendEvent: vi.fn(),
  requireOrgRole: vi.fn(),
  withLock: vi.fn(async (_key: string, fn: () => Promise<unknown>) => fn()),
  client: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

vi.mock("@/config/env", () => ({ env: mocks.env }));

// Spread the real module so withStorageLocationRegistrationLocks keeps
// running against the mocked @/db advisory lock below.
vi.mock("@/data-access/certifier-storage-locations", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/data-access/certifier-storage-locations")
  >()),
  getStorageLocationRegistryInput: mocks.getInput,
  getStorageLocationRegistration: mocks.getRegistration,
  persistStorageLocationRegistration: mocks.persistRegistration,
  replaceMissingStorageLocationRegistration: mocks.replaceRegistration,
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
vi.mock("@/data-access/certification", () => ({ markSubmissionRejected: vi.fn() }));
vi.mock("./registry-create", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./registry-create")>();
  return { ...actual, performRegistryCreate: vi.fn(actual.performRegistryCreate) };
});

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
  mocks.replaceRegistration.mockImplementation(async (_ctx, old, externalStorageLocationId) => ({ ...old, externalStorageLocationId }));
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

  it("enters the exact nested registration locks before rechecking the journal", async () => {
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
    mocks.client.get.mockResolvedValue(remote(supplierReference));
    const events: string[] = [];
    mocks.getRegistration
      .mockImplementationOnce(async () => {
        events.push("journal:before-locks");
        return null;
      })
      .mockImplementationOnce(async () => {
        events.push("journal:under-locks");
        return registration({
          supplierReference,
          submittedPayload,
          payloadHash: payloadHash(submittedPayload),
        });
      });
    mocks.withLock.mockImplementation(
      async (key: string, fn: () => Promise<unknown>) => {
        events.push(`lock-acquired:${key}`);
        return fn();
      },
    );

    const result = await ensure();

    const lockKeys = [
      `certifier-storage-location:isometric:prj-test:${CUSTOMER_LOCATION_ID}`,
      "certifier-project-mapping:org-test:isometric:facility-1",
      "certifier-external-project:org-test:isometric:prj-test",
    ];
    expect(mocks.withLock.mock.calls.map(([key]) => key)).toEqual(lockKeys);
    expect(events).toEqual([
      "journal:before-locks",
      ...lockKeys.map((key) => `lock-acquired:${key}`),
      "journal:under-locks",
    ]);
    expect(mocks.client.get).toHaveBeenCalledTimes(1);
    expect(mocks.client.post).not.toHaveBeenCalled();
    expect(result).toMatchObject({ source: "journal", drifted: false });
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

  it("marks facts changed during POST as drift before reporting the result", async () => {
    mocks.getInput
      .mockResolvedValueOnce(input())
      .mockResolvedValueOnce(input())
      .mockResolvedValueOnce(input({ name: "South Field" }));

    const result = await ensure();

    expect(result).toMatchObject({ source: "create", drifted: true });
    expect(mocks.setDrift).toHaveBeenCalledWith(
      orgCtx,
      "registration-1",
      expect.objectContaining({
        status: "drifted",
        details: expect.objectContaining({
          remoteDriftReason: expect.stringMatching(/changed while/),
        }),
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

  it("recovers a deleted remote registration using the unchanged stable site reference", async () => {
    const { IsometricApiError } = await import("@/lib/isometric/client");
    const { buildStorageLocationReference } = await import("@/lib/isometric/storage-locations");
    const { payloadHash } = await import("@/lib/isometric/utils/payload-hash");
    const supplierReference = buildStorageLocationReference({
      customerLocationId: CUSTOMER_LOCATION_ID, externalProjectId: "prj-test",
    });
    const submittedPayload = { ...registration().submittedPayload, supplier_reference_id: supplierReference };
    mocks.getRegistration.mockResolvedValue(registration({
      externalStorageLocationId: "slc-deleted", supplierReference,
      submittedPayload, payloadHash: payloadHash(submittedPayload),
    }));
    const originalGet = mocks.client.get.getMockImplementation()!;
    mocks.client.get.mockImplementation(async (path: string) => {
      if (path.endsWith("/slc-deleted")) throw new IsometricApiError("missing", 404);
      return originalGet(path);
    });

    await expect(ensure()).resolves.toMatchObject({
      externalStorageLocationId: "slc-test", source: "create", drifted: false,
    });
    expect(mocks.client.post).toHaveBeenCalledTimes(1);
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

  it("uses the same synchronization lifecycle in production", async () => {
    mocks.env.ISOMETRIC_ENVIRONMENT = "production";

    await expect(ensure()).resolves.toMatchObject({
      externalStorageLocationId: "slc-test",
      source: "create",
    });
    expect(mocks.getInput).toHaveBeenCalled();
    expect(mocks.client.post).toHaveBeenCalledTimes(1);
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


async function missingRegistration() {
  const { IsometricApiError } = await import("@/lib/isometric/client");
  const { buildStorageLocationReference } = await import("@/lib/isometric/storage-locations");
  const { payloadHash } = await import("@/lib/isometric/utils/payload-hash");
  const supplierReference = buildStorageLocationReference({
    customerLocationId: CUSTOMER_LOCATION_ID, externalProjectId: "prj-test",
  });
  const submittedPayload = { ...registration().submittedPayload, supplier_reference_id: supplierReference };
  let current = registration({
    externalStorageLocationId: "slc-deleted", supplierReference,
    submittedPayload, payloadHash: payloadHash(submittedPayload),
  });
  const old = current;
  mocks.getRegistration.mockImplementation(async () => current);
  mocks.replaceRegistration.mockImplementation(async (_ctx, expected, externalStorageLocationId) => {
    expect(expected.externalStorageLocationId).toBe(current.externalStorageLocationId);
    current = { ...current, externalStorageLocationId };
    return current;
  });
  const candidates: ReturnType<typeof remote>[] = [];
  mocks.client.get.mockImplementation(async (path: string) => {
    if (path.endsWith("/slc-deleted")) throw new IsometricApiError("missing", 404);
    if (path.endsWith("/storage_locations")) return {
      nodes: candidates, page_info: { has_next_page: false },
    };
    return candidates.find((candidate) => path.endsWith(`/${candidate.id}`));
  });
  mocks.client.post.mockImplementation(async () => {
    const created = remote(supplierReference, "slc-replacement");
    candidates.push(created);
    return created;
  });
  return { old, candidates, supplierReference };
}

function serializeLocks() {
  const tails = new Map<string, Promise<void>>();
  mocks.withLock.mockImplementation(async (key: string, fn: () => Promise<unknown>) => {
    const previous = tails.get(key) ?? Promise.resolve();
    let release = () => {};
    const tail = new Promise<void>((resolve) => { release = resolve; });
    tails.set(key, tail);
    await previous;
    try { return await fn(); } finally { release(); }
  });
}

describe("missing Storage Location recovery", () => {
  it("adopts an existing replacement without POST and preserves the submitted snapshot", async () => {
    const { old, candidates, supplierReference } = await missingRegistration();
    candidates.push(remote(supplierReference, "slc-replacement"));
    const result = await ensure();
    expect(result).toMatchObject({ source: "reconciliation", drifted: false,
      externalStorageLocationId: "slc-replacement", registration: {
        id: old.id, submittedPayload: old.submittedPayload, payloadHash: old.payloadHash,
      },
    });
    expect(mocks.client.post).not.toHaveBeenCalled();
    expect(mocks.persistRegistration).not.toHaveBeenCalled();
    expect(mocks.appendEvent).toHaveBeenCalledWith(orgCtx, expect.objectContaining({
      operation: "storage-location:recovered",
      responsePayload: { oldId: "slc-deleted", newId: "slc-replacement" },
    }));
  });

  it("refuses duplicate supplier references before POST or persistence", async () => {
    const { candidates, supplierReference } = await missingRegistration();
    candidates.push(remote(supplierReference, "slc-a"), remote(supplierReference, "slc-b"));
    await expect(ensure()).rejects.toThrow(/Multiple Isometric Storage Locations/);
    expect(mocks.client.post).not.toHaveBeenCalled();
    expect(mocks.replaceRegistration).not.toHaveBeenCalled();
  });

  it.each([{ project_id: "prj-other" }, { latitude: -4 }, { name: "Different field" }])(
    "refuses a replacement with mismatched facts: %s", async (patch) => {
      const { candidates, supplierReference } = await missingRegistration();
      candidates.push({ ...remote(supplierReference, "slc-replacement"), ...patch });
      await expect(ensure()).rejects.toThrow(/conflicts/);
      expect(mocks.client.post).not.toHaveBeenCalled();
      expect(mocks.replaceRegistration).not.toHaveBeenCalled();
    },
  );

  it("refuses an inconsistent saved supplier reference", async () => {
    const { old } = await missingRegistration();
    mocks.getRegistration.mockResolvedValue({ ...old, supplierReference: "nm-slc-other" });
    await expect(ensure()).rejects.toThrow(/saved Storage Location identity is inconsistent/);
    expect(mocks.client.post).not.toHaveBeenCalled();
    expect(mocks.replaceRegistration).not.toHaveBeenCalled();
  });

  it.each([400, 401, 403, 429, 500, undefined])("fails closed on GET status %s", async (status) => {
    await missingRegistration();
    const { IsometricApiError } = await import("@/lib/isometric/client");
    const error = new IsometricApiError("unavailable", status);
    mocks.client.get.mockRejectedValue(error);
    await expect(ensure()).rejects.toBe(error);
    expect(mocks.client.post).not.toHaveBeenCalled();
    expect(mocks.replaceRegistration).not.toHaveBeenCalled();
    expect(mocks.setDrift).not.toHaveBeenCalled();
  });

  it("does not treat a failed reference lookup as permission to POST", async () => {
    await missingRegistration();
    const { IsometricApiError } = await import("@/lib/isometric/client");
    mocks.client.get.mockRejectedValue(new IsometricApiError("missing", 404));
    await expect(ensure()).rejects.toThrow();
    expect(mocks.client.post).not.toHaveBeenCalled();
    expect(mocks.replaceRegistration).not.toHaveBeenCalled();
  });

  it("rechecks absence after acquiring locks and stops on an inconclusive GET", async () => {
    await missingRegistration();
    const { IsometricApiError } = await import("@/lib/isometric/client");
    mocks.client.get.mockRejectedValueOnce(new IsometricApiError("missing", 404))
      .mockRejectedValueOnce(new IsometricApiError("unavailable", 503));
    await expect(ensure()).rejects.toThrow();
    expect(mocks.client.post).not.toHaveBeenCalled();
    expect(mocks.replaceRegistration).not.toHaveBeenCalled();
  });

  it("serializes concurrent recoveries and reuses the winning replacement", async () => {
    await missingRegistration();
    serializeLocks();
    const results = await Promise.all([ensure(), ensure()]);
    expect(results.map((result) => result.externalStorageLocationId)).toEqual([
      "slc-replacement", "slc-replacement",
    ]);
    expect(results.every((result) => !result.drifted)).toBe(true);
    expect(mocks.client.post).toHaveBeenCalledTimes(1);
    expect(mocks.replaceRegistration).toHaveBeenCalledTimes(1);
  });

  it("reconciles an ambiguous POST response without a second POST", async () => {
    const { candidates, supplierReference } = await missingRegistration();
    mocks.client.post.mockImplementation(async () => {
      candidates.push(remote(supplierReference, "slc-replacement"));
      throw new Error("response lost");
    });
    await expect(ensure()).resolves.toMatchObject({ source: "reconciliation", externalStorageLocationId: "slc-replacement" });
    await expect(ensure()).resolves.toMatchObject({ source: "journal", externalStorageLocationId: "slc-replacement" });
    expect(mocks.client.post).toHaveBeenCalledTimes(1);
  });

  it("reconciles after persistence fails without duplicating the successful POST", async () => {
    await missingRegistration();
    mocks.replaceRegistration.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(ensure()).rejects.toThrow(/database unavailable/);
    await expect(ensure()).resolves.toMatchObject({ source: "reconciliation", externalStorageLocationId: "slc-replacement" });
    expect(mocks.client.post).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed recovery retryable through persistent provider errors", async () => {
    const { old } = await missingRegistration();
    const { IsometricApiError } = await import("@/lib/isometric/client");
    const post = mocks.client.post.getMockImplementation()!;
    mocks.client.post.mockRejectedValue(new IsometricApiError("unavailable", 503));
    await expect(ensure()).rejects.toThrow();
    await expect(ensure()).rejects.toThrow();
    expect(await mocks.getRegistration()).toEqual(old);
    expect(mocks.replaceRegistration).not.toHaveBeenCalled();
    mocks.client.post.mockImplementation(post);
    await expect(ensure()).resolves.toMatchObject({ externalStorageLocationId: "slc-replacement" });
  });

  it("preserves real local drift even when the old registry record is missing", async () => {
    await missingRegistration();
    mocks.getInput.mockResolvedValue(input({ latitude: -4 }));
    await expect(ensure()).resolves.toMatchObject({ drifted: true, externalStorageLocationId: "slc-deleted" });
    expect(mocks.client.post).not.toHaveBeenCalled();
    expect(mocks.replaceRegistration).not.toHaveBeenCalled();
  });

  it("revalidates reviewed inputs before recovering", async () => {
    const { old } = await missingRegistration();
    mocks.getInput.mockResolvedValue(input({ name: "Changed field" }));
    await expect(ensureStorageLocation({ orgCtx, applicationId: "app-1", log, expected: {
      customerLocationId: CUSTOMER_LOCATION_ID, certifierProjectId: "mapping-1",
      externalProjectId: "prj-test", supplierReference: old.supplierReference,
      payload: old.submittedPayload,
    } })).rejects.toThrow(/changed after this Removal was reviewed/);
    expect(mocks.client.get).not.toHaveBeenCalled();
    expect(mocks.client.post).not.toHaveBeenCalled();
  });

  it("refuses site changes while acquiring recovery locks", async () => {
    await missingRegistration();
    mocks.getInput.mockResolvedValueOnce(input()).mockResolvedValueOnce(input({ latitude: -4 }));
    await expect(ensure()).rejects.toThrow(/site changed while/);
    expect(mocks.client.post).not.toHaveBeenCalled();
  });

  it("does not recover a live record with a mismatched identity", async () => {
    const { supplierReference } = await missingRegistration();
    mocks.client.get.mockResolvedValue(remote(supplierReference, "slc-wrong"));
    await expect(ensure()).resolves.toMatchObject({ drifted: true, source: "journal" });
    expect(mocks.client.post).not.toHaveBeenCalled();
    expect(mocks.replaceRegistration).not.toHaveBeenCalled();
  });
});
