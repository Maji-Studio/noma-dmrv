import { describe, expect, it } from "vitest";
import type { RemovalHubEntry } from "@/fn/certification/certify-context";
import type { RemovalPreflightSummary } from "@/fn/certification/overview";
import {
  buildRemovalListRows,
  canDeleteRemovalRow,
  removalDeletionTouchesRegistry,
} from "./removal-list-state";

function identity(
  id: string,
  batchCode: string,
): RemovalHubEntry {
  return {
    removal: {
      id,
      startedOn: null,
      completedOn: null,
    },
    memberBatches: [{ id: `${id}-batch`, code: batchCode }],
    latestSubmission: null,
    hasFinalizedSubmission: false,
    registryBoundaryOpened: false,
  } as RemovalHubEntry;
}

function enrichment(
  id: string,
): RemovalPreflightSummary {
  return {
    removalId: id,
    code: "RM-26-001",
    startedOn: "2026-07-01",
    completedOn: "2026-07-31",
    memberBatchCodes: [`${id}-enriched`],
    externalId: null,
    version: null,
    local: null,
    lockInFlight: false,
    submissionInterrupted: false,
    hasFinalizedSubmission: false,
    registryBoundaryOpened: false,
    readiness: { state: "ready", reasons: [], advisories: [], transportVehicleAdvisories: [] },
    evidenceHealth: null,
    submissionWarnings: [],
    recentSyncEvents: [],
  };
}

describe("buildRemovalListRows", () => {
  it("keeps every identity row visible while enrichment loads or fails independently", () => {
    const rows = buildRemovalListRows(
      [identity("removal-a", "CB-A"), identity("removal-b", "CB-B")],
      {
        "removal-a": { status: "available", data: enrichment("removal-a") },
        "removal-b": {
          status: "unavailable",
          data: null,
          retry: () => undefined,
        },
      },
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      removalId: "removal-a",
      memberBatchCodes: ["removal-a-enriched"],
      enrichmentStatus: "available",
    });
    expect(rows[1]).toMatchObject({
      removalId: "removal-b",
      memberBatchCodes: ["CB-B"],
      enrichmentStatus: "unavailable",
    });
    expect(rows[1].retry).toBeTypeOf("function");
  });

  it("preserves an active identity-level submission lock when enrichment is unavailable", () => {
    const locked = identity("removal-locked", "CB-LOCKED");
    locked.latestSubmission = {
      status: "draft",
      lockedAt: new Date(),
    } as NonNullable<RemovalHubEntry["latestSubmission"]>;

    const [row] = buildRemovalListRows([locked], {
      "removal-locked": { status: "unavailable", data: null },
    });

    expect(row.lockInFlight).toBe(true);
  });

  it("preserves an interrupted attempt marker while enrichment is unavailable", () => {
    const interrupted = identity("removal-interrupted", "CB-INTERRUPTED");
    interrupted.latestSubmission = {
      status: "draft",
      lockedAt: new Date(),
      metadata: { lastAttemptOutcome: "interrupted" },
    } as NonNullable<RemovalHubEntry["latestSubmission"]>;

    const [row] = buildRemovalListRows([interrupted], {
      "removal-interrupted": { status: "unavailable", data: null },
    });

    expect(row.submissionInterrupted).toBe(true);
  });

  it("flags a submitted Removal with no reporting window for recovery", () => {
    const incomplete = identity("removal-incomplete", "CB-INCOMPLETE");
    incomplete.latestSubmission = {
      status: "submitted",
      externalId: "rmv-existing",
      lockedAt: null,
    } as NonNullable<RemovalHubEntry["latestSubmission"]>;

    const [row] = buildRemovalListRows([incomplete], {
      "removal-incomplete": { status: "unavailable", data: null },
    });

    expect(row).toMatchObject({
      local: "submitted",
      startedOn: null,
      completedOn: null,
      submissionInterrupted: true,
    });
  });

  it("ignores stale lifecycle enrichment when a refresh is unavailable", () => {
    const interrupted = identity("removal-stale", "CB-STALE");
    interrupted.latestSubmission = {
      status: "draft",
      lockedAt: new Date(),
      metadata: { lastAttemptOutcome: "interrupted" },
    } as NonNullable<RemovalHubEntry["latestSubmission"]>;
    const stale = enrichment("removal-stale");

    const [row] = buildRemovalListRows([interrupted], {
      "removal-stale": { status: "unavailable", data: stale },
    });

    expect(row).toMatchObject({
      local: "draft",
      lockInFlight: true,
      submissionInterrupted: true,
      readiness: null,
    });
  });
});

const LOCAL_ROW = {
  local: null,
  lockInFlight: false,
  submissionInterrupted: false,
  hasFinalizedSubmission: false,
  registryBoundaryOpened: false,
} as const;
const FLOOR_MET = {
  viewerCanDeleteRegistryRemovals: true,
  hasRegisteredProductionBatches: false,
} as const;
const BELOW_FLOOR = {
  viewerCanDeleteRegistryRemovals: false,
  hasRegisteredProductionBatches: false,
} as const;

describe("canDeleteRemovalRow", () => {
  it("allows removals that never finalized a submission", () => {
    expect(canDeleteRemovalRow(LOCAL_ROW, FLOOR_MET)).toBe(true);
    expect(canDeleteRemovalRow({ ...LOCAL_ROW, local: "draft" }, FLOOR_MET)).toBe(true);
    expect(canDeleteRemovalRow({ ...LOCAL_ROW, local: "rejected" }, FLOOR_MET)).toBe(true);
  });

  it("refuses when an earlier version finalized even if the latest is a draft", () => {
    expect(canDeleteRemovalRow({ ...LOCAL_ROW, local: "draft", hasFinalizedSubmission: true }, FLOOR_MET)).toBe(false);
  });

  it("refuses removals whose submission completed", () => {
    expect(canDeleteRemovalRow({ ...LOCAL_ROW, local: "submitted" }, FLOOR_MET)).toBe(false);
    expect(canDeleteRemovalRow({ ...LOCAL_ROW, local: "accepted" }, FLOOR_MET)).toBe(false);
    expect(canDeleteRemovalRow({ ...LOCAL_ROW, local: "superseded" }, FLOOR_MET)).toBe(false);
  });

  it("waits for a running attempt but not for an interrupted one", () => {
    expect(canDeleteRemovalRow({ ...LOCAL_ROW, local: "draft", lockInFlight: true }, FLOOR_MET)).toBe(false);
    expect(canDeleteRemovalRow({ ...LOCAL_ROW, local: "draft", lockInFlight: true, submissionInterrupted: true }, FLOOR_MET)).toBe(true);
  });

  describe("role floor (issue #746)", () => {
    it("lets a member delete a Removal that never touched the registry", () => {
      expect(canDeleteRemovalRow(LOCAL_ROW, BELOW_FLOOR)).toBe(true);
    });

    it.each([
      ["a ledger row", { ...LOCAL_ROW, local: "draft" as const }, BELOW_FLOOR],
      ["a rejected ledger row", { ...LOCAL_ROW, local: "rejected" as const }, BELOW_FLOOR],
      ["the external mutation marker", { ...LOCAL_ROW, registryBoundaryOpened: true }, BELOW_FLOOR],
      ["a registered Production Batch", LOCAL_ROW, { ...BELOW_FLOOR, hasRegisteredProductionBatches: true }],
    ])("refuses a member once %s opened the registry boundary", (_label, row, access) => {
      expect(canDeleteRemovalRow(row, access)).toBe(false);
    });

    it.each([
      ["a ledger row", { ...LOCAL_ROW, local: "draft" as const }, FLOOR_MET],
      ["the external mutation marker", { ...LOCAL_ROW, registryBoundaryOpened: true }, FLOOR_MET],
      ["a registered Production Batch", LOCAL_ROW, { ...FLOOR_MET, hasRegisteredProductionBatches: true }],
    ])("lets a viewer at the floor delete once %s opened the boundary", (_label, row, access) => {
      expect(canDeleteRemovalRow(row, access)).toBe(true);
    });

    it("hides the action while the viewer role or Production Batch facts are unknown", () => {
      expect(canDeleteRemovalRow(LOCAL_ROW, { viewerCanDeleteRegistryRemovals: null, hasRegisteredProductionBatches: null })).toBe(false);
      expect(canDeleteRemovalRow(LOCAL_ROW, { viewerCanDeleteRegistryRemovals: false, hasRegisteredProductionBatches: null })).toBe(false);
      expect(canDeleteRemovalRow(LOCAL_ROW, { viewerCanDeleteRegistryRemovals: null, hasRegisteredProductionBatches: false })).toBe(true);
      expect(canDeleteRemovalRow({ ...LOCAL_ROW, registryBoundaryOpened: true }, { viewerCanDeleteRegistryRemovals: null, hasRegisteredProductionBatches: false })).toBe(false);
      expect(canDeleteRemovalRow({ ...LOCAL_ROW, local: "draft" }, { viewerCanDeleteRegistryRemovals: true, hasRegisteredProductionBatches: null })).toBe(true);
    });
  });
});

describe("removalDeletionTouchesRegistry", () => {
  it("counts a registered Production Batch as registry history", () => {
    expect(removalDeletionTouchesRegistry(LOCAL_ROW)).toBe(false);
    expect(removalDeletionTouchesRegistry(LOCAL_ROW, { hasRegisteredProductionBatches: null })).toBe(false);
    expect(removalDeletionTouchesRegistry(LOCAL_ROW, { hasRegisteredProductionBatches: true })).toBe(true);
    expect(removalDeletionTouchesRegistry({ ...LOCAL_ROW, registryBoundaryOpened: true })).toBe(true);
    expect(removalDeletionTouchesRegistry({ ...LOCAL_ROW, local: "rejected" })).toBe(true);
  });
});
