import { beforeEach, describe, expect, it, vi } from "vitest";
import { DomainError } from "@/lib/domain-errors";
import { SafeError } from "@/lib/errors";
import { formatCertificationLineageLockMessage } from "@/lib/certification/lineage-lock-message";
import { STALE_VERSION_CONFLICT_CODE, STALE_VERSION_MESSAGE } from "@/lib/stale-version";
import { refreshDeliveryDistanceFn, refreshFeedstockDistanceFn } from "./transport-distance-refresh";

const mocks = vi.hoisted(() => ({
  row: vi.fn(), preview: vi.fn(), guard: vi.fn(), recheck: vi.fn(), update: vi.fn(), sync: vi.fn(), activity: vi.fn(),
}));
vi.mock("@/lib/auth/server", () => ({
  requireOrgContext: async () => ({ organizationId: "session-org", userId: "actor", orgRole: "owner", isPlatformAdmin: false }),
}));
vi.mock("@/db", () => ({
  db: { transaction: async (work: (tx: unknown) => Promise<unknown>) => work({
    select: () => ({ from: () => ({ where: () => ({ for: mocks.row }) }) }),
    update: mocks.update,
  }) },
}));
vi.mock("@/data-access/transport-distance-drift", () => ({
  distanceRefreshLineageTargets: async (_ctx: unknown, _tx: unknown, target: unknown) => [target],
  getTransportDistanceDrift: mocks.preview,
}));
vi.mock("@/data-access/certification-lineage-guards", () => ({
  lockCertifiedLineageArtifacts: async () => new Set(),
  assertCanMutateCertifiedLineage: mocks.guard,
  assertLockedLineagesAllowMutation: mocks.recheck,
}));
vi.mock("@/data-access/transport-legs", () => ({
  lockBiocharTransportRouteTopology: async () => {},
  syncFeedstockTransportLeg: mocks.sync,
  syncBiocharProductTransportLegs: mocks.sync,
}));
vi.mock("@/data-access/write-activity", () => ({
  recordScopedWriteActivity: mocks.activity,
  resolveWriteActivityScopes: vi.fn(),
}));
vi.mock("@/data-access/storage-object-deletions", () => ({ processPendingStorageObjectDeletions: vi.fn() }));

const ID = "00000000-0000-4000-8000-000000000001";
const VERSION = 1;
const INPUT = { entityId: ID, expectedVersion: VERSION };
const ROW = { id: ID, version: VERSION, distanceKmOverride: null };
const LOCKED_MESSAGE = "The distance was not refreshed because its transport data belongs to a locked Removal. Ask an Organization Admin to review the linked Removal.";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.row.mockResolvedValue([ROW]);
  mocks.update.mockReturnValue({ set: () => ({ where: async () => undefined }) });
  mocks.preview.mockResolvedValue({ currentDistanceKm: 55 });
});

describe.each([
  { entityType: "feedstock" as const, refresh: refreshFeedstockDistanceFn, noun: "Feedstock" },
  { entityType: "delivery" as const, refresh: refreshDeliveryDistanceFn, noun: "Delivery" },
])("$entityType refresh refusal codes", ({ entityType, refresh, noun }) => {
  it("records the entity's distance fields on refresh", async () => {
    expect(await refresh(INPUT)).toMatchObject({ success: true });
    expect(mocks.activity).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
      changedFields: entityType === "feedstock" ? ["transportDistanceKm", "transportDistanceSource"]
        : ["recordedDistanceKm", "recordedDistanceSource"],
    }), undefined);
  });

  it("returns certification_locked when submission locks the lineage after preview", async () => {
    mocks.guard.mockRejectedValue(new SafeError(formatCertificationLineageLockMessage({
      mutation: "update", subjectEntityType: entityType, lineageEntityType: entityType,
    })));
    expect(await refresh(INPUT)).toMatchObject({ success: false, code: "certification_locked", error: LOCKED_MESSAGE });
  });

  it("returns not_found for a missing or archived record", async () => {
    mocks.row.mockResolvedValue([]);
    expect(await refresh(INPUT)).toMatchObject({ success: false, code: "not_found", error: `${noun} was not found or is archived.` });
  });

  it("returns validation_failed for a missing pair distance", async () => {
    mocks.preview.mockResolvedValue({ currentDistanceKm: null });
    mocks.sync.mockRejectedValue(new DomainError("validation_failed",
      "The distance was not refreshed because the location has no distance for this facility. Save a location distance first."));
    expect(await refresh(INPUT)).toMatchObject({ success: false, code: "validation_failed",
      error: "The distance was not refreshed because the location has no distance for this facility. Save a location distance first." });
  });

  it("returns validation_failed for an overridden distance", async () => {
    mocks.row.mockResolvedValue([{ ...ROW, distanceKmOverride: 25 }]);
    expect(await refresh(INPUT)).toMatchObject({ success: false, code: "validation_failed",
      error: "The distance was not refreshed because it has an override. Clear the override first." });
  });

  it("returns stale_version with the stale-version reference", async () => {
    mocks.row.mockResolvedValue([{ ...ROW, version: VERSION + 1 }]);
    expect(await refresh(INPUT)).toMatchObject({ success: false, code: "stale_version", error: STALE_VERSION_MESSAGE,
      conflict: { entity: entityType, id: ID, code: STALE_VERSION_CONFLICT_CODE } });
  });
});

it("preserves the delivery lock recheck message with a certification_locked code", async () => {
  const message = formatCertificationLineageLockMessage({ mutation: "update", subjectEntityType: "delivery", lineageEntityType: "delivery" });
  mocks.recheck.mockRejectedValue(new SafeError(message));
  expect(await refreshDeliveryDistanceFn(INPUT)).toMatchObject({ success: false, code: "certification_locked", error: message });
});
