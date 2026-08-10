import { describe, expect, it } from "vitest";
import type { RemovalHubEntry } from "@/fn/certification/certify-context";
import type { RemovalPreflightSummary } from "@/fn/certification/overview";
import { buildRemovalListRows } from "./removal-list-state";

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
  } as RemovalHubEntry;
}

function enrichment(
  id: string,
): RemovalPreflightSummary {
  return {
    removalId: id,
    startedOn: "2026-07-01",
    completedOn: "2026-07-31",
    memberBatchCodes: [`${id}-enriched`],
    externalId: null,
    version: null,
    local: null,
    lockInFlight: false,
    submissionInterrupted: false,
    readiness: { state: "ready", reasons: [], advisories: [] },
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
