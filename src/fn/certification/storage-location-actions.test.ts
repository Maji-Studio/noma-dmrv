import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgContext } from "@/lib/auth/server";

const ORG_CTX: OrgContext = {
  organizationId: "org-test",
  userId: "user-test",
  orgRole: "admin",
  isPlatformAdmin: false,
};
const APPLICATION_ID = "11111111-1111-4111-8111-111111111111";
const CUSTOMER_LOCATION_ID = "22222222-2222-4222-8222-222222222222";

const mocks = vi.hoisted(() => ({
  getInput: vi.fn(),
  getRegistration: vi.fn(),
  listEvents: vi.fn(),
  ensure: vi.fn(),
  requireRole: vi.fn(),
  appendEvent: vi.fn(),
}));

vi.mock("../with-action", () => ({
  withAction: async <T>(fn: (ctx: OrgContext) => Promise<T>) => {
    try {
      return { success: true as const, data: await fn(ORG_CTX) };
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : "Unexpected error",
      };
    }
  },
}));
vi.mock("@/config/env", () => ({
  env: { ISOMETRIC_ENVIRONMENT: "sandbox" },
}));
vi.mock("@/data-access/certifier-storage-locations", () => ({
  getStorageLocationRegistryInput: mocks.getInput,
  getStorageLocationRegistration: mocks.getRegistration,
}));
vi.mock("@/data-access/certification", () => ({
  listRecentSyncEvents: mocks.listEvents,
}));
vi.mock("@/lib/auth/server", () => ({
  requireOrgRole: mocks.requireRole,
}));
vi.mock("./storage-locations", () => ({
  ensureStorageLocation: mocks.ensure,
  missingStorageLocationFacts: (input: ReturnType<typeof registryInput>) => [
    !input.certifierProjectId || !input.externalProjectId
      ? "project_mapping"
      : null,
    typeof input.name === "string" && input.name.trim() ? null : "site_name",
    input.latitude == null ? "latitude" : null,
    input.longitude == null ? "longitude" : null,
  ].filter(Boolean),
  STORAGE_LOCATION_ENTITY_TYPE: "customerLocation",
  STORAGE_LOCATION_OPERATION_PREFIX: "storage-location:",
  STORAGE_LOCATION_SYNC_OPERATION: "storage-location:sync",
}));
vi.mock("./shared", () => ({
  appendSyncEventBestEffort: mocks.appendEvent,
  ISOMETRIC_PROVIDER: "isometric",
  submitRateLimit: (key: string) => ({ key, max: 5, windowMs: 60_000 }),
}));

import {
  loadApplicationStorageLocationSync,
  syncApplicationStorageLocation,
} from "./storage-location-actions";

function registryInput(overrides: Record<string, unknown> = {}) {
  return {
    applicationId: APPLICATION_ID,
    facilityId: "55555555-5555-4555-8555-555555555555",
    customerLocationId: CUSTOMER_LOCATION_ID,
    certifierProjectId: "33333333-3333-4333-8333-333333333333",
    externalProjectId: "prj-test",
    name: "North Field",
    latitude: -3.25,
    longitude: 37.42,
    ...overrides,
  };
}

function registration(overrides: Record<string, unknown> = {}) {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    organizationId: ORG_CTX.organizationId,
    provider: "isometric",
    customerLocationId: CUSTOMER_LOCATION_ID,
    certifierProjectId: "33333333-3333-4333-8333-333333333333",
    externalProjectId: "prj-test",
    externalStorageLocationId: "slc-test",
    supplierReference: "nm-slc-test",
    submittedPayload: {},
    payloadHash: "hash",
    driftStatus: "in_sync",
    driftDetails: null,
    driftDetectedAt: null,
    createdAt: new Date("2026-08-13T10:00:00Z"),
    updatedAt: new Date("2026-08-13T10:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getInput.mockResolvedValue(registryInput());
  mocks.getRegistration.mockResolvedValue(null);
  mocks.listEvents.mockResolvedValue([]);
});

describe("application Storage Location actions", () => {
  it("reports not-synced, synced, drifted, and failed states from local journals", async () => {
    await expect(
      loadApplicationStorageLocationSync(APPLICATION_ID),
    ).resolves.toMatchObject({
      success: true,
      data: { state: "not_synced", externalStorageLocationId: null },
    });

    mocks.getRegistration.mockResolvedValue(registration());
    await expect(
      loadApplicationStorageLocationSync(APPLICATION_ID),
    ).resolves.toMatchObject({
      success: true,
      data: { state: "synced", externalStorageLocationId: "slc-test" },
    });

    mocks.getRegistration.mockResolvedValue(
      registration({ driftStatus: "drifted", driftDetectedAt: new Date() }),
    );
    await expect(
      loadApplicationStorageLocationSync(APPLICATION_ID),
    ).resolves.toMatchObject({
      success: true,
      data: { state: "drifted", externalStorageLocationId: "slc-test" },
    });

    mocks.getRegistration.mockResolvedValue(null);
    mocks.listEvents.mockResolvedValue([
      {
        id: "event-1",
        operation: "storage-location:sync",
        status: "failed",
        errorMessage: "Registry unavailable",
        attemptedAt: new Date("2026-08-13T11:00:00Z"),
      },
    ]);
    await expect(
      loadApplicationStorageLocationSync(APPLICATION_ID),
    ).resolves.toMatchObject({
      success: true,
      data: {
        state: "failed",
        externalStorageLocationId: null,
        lastError: "Registry unavailable",
      },
    });
  });

  it("runs synchronization only from the explicit admin action", async () => {
    mocks.ensure.mockResolvedValue({
      externalStorageLocationId: "slc-test",
      registration: registration(),
      source: "create",
      drifted: false,
    });
    mocks.getRegistration.mockResolvedValue(registration());

    const result = await syncApplicationStorageLocation(APPLICATION_ID);

    expect(mocks.requireRole).toHaveBeenCalledWith(ORG_CTX, "admin");
    expect(mocks.ensure).toHaveBeenCalledWith(
      expect.objectContaining({
        orgCtx: ORG_CTX,
        applicationId: APPLICATION_ID,
      }),
    );
    expect(mocks.ensure.mock.calls[0]?.[0]).not.toHaveProperty("submissionRow");
    expect(result).toMatchObject({
      success: true,
      data: { state: "synced", externalStorageLocationId: "slc-test" },
    });
  });

  it("shows a failed check when its site event is newer than the registration", async () => {
    mocks.getRegistration.mockResolvedValue(
      registration({ updatedAt: new Date("2026-08-13T10:00:00Z") }),
    );
    mocks.listEvents.mockResolvedValue([
      {
        id: "event-newer-failure",
        operation: "storage-location:sync",
        status: "failed",
        errorMessage: "Registry unavailable",
        attemptedAt: new Date("2026-08-13T11:00:00Z"),
      },
    ]);

    await expect(
      loadApplicationStorageLocationSync(APPLICATION_ID),
    ).resolves.toMatchObject({
      success: true,
      data: {
        state: "failed",
        externalStorageLocationId: "slc-test",
        lastError: "Registry unavailable",
      },
    });
  });
});
