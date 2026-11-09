/** Real PostgreSQL queries against a session-local TEMP table, rolled back. */
import { countQueries } from "../../tests/helpers/query-counter";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { certifierSyncEvents } from "@/db/schema/certification";
import type { OrgContext } from "@/lib/auth/server";
import { CHANGED_SINCE_REVIEW_FAILURE_KIND } from "@/lib/certification/interrupted-removal-copy";
import {
  ATTEMPT_SUMMARY_OPERATION, DRIFT_OPERATION_PREFIX, deriveSubmissionAttempts,
} from "@/lib/certification/submission-attempts";
import { listRemovalAttemptEvents } from "./certifier-sync-events";
import { getRemovalIdsWithChangedLatestAttempt } from "./removal-latest-attempt";

const CONNECTION_TIMEOUT_MS = 1_000;
const LOOKUP_QUERY_BUDGET = 2;
const url = process.env.DATABASE_URL;
const probe = new Client({ connectionString: url, connectionTimeoutMillis: CONNECTION_TIMEOUT_MS });
const available = await probe.connect().then(() => true, () => false);
await probe.end();
if (!available && process.env.CI) throw new Error("Removal latest attempt tests require PostgreSQL in CI");

const ctx: OrgContext = {
  organizationId: "latest-attempt-org", userId: "latest-attempt-user", orgRole: "admin", isPlatformAdmin: false,
};
const OTHER_ORG = "latest-attempt-other-org";
const ids = {
  changed: randomUUID(), laterFailure: randomUUID(), drift: randomUUID(), legacyDrift: randomUUID(), foreign: randomUUID(),
};
const OLDER = new Date("2026-11-01T12:00:00Z");
const LATEST = new Date("2026-11-02T12:00:00Z");
const ATTEMPT_END = new Date("2026-11-02T12:01:00Z");
const DRIFT_AT = new Date("2026-11-02T12:00:30Z");
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
type EventInsert = typeof certifierSyncEvents.$inferInsert;

function summary(entityId: string, overrides: Partial<EventInsert> = {}): EventInsert {
  return {
    id: randomUUID(), organizationId: ctx.organizationId, provider: "isometric", entityType: "removal", entityId,
    operation: ATTEMPT_SUMMARY_OPERATION, status: "failed", attemptedAt: LATEST, createdAt: ATTEMPT_END,
    responsePayload: { attempt_id: entityId, failure_kind: CHANGED_SINCE_REVIEW_FAILURE_KIND },
    ...overrides,
  };
}

function drift(entityId: string, overrides: Partial<EventInsert> = {}): EventInsert {
  return {
    ...summary(entityId), operation: `${DRIFT_OPERATION_PREFIX}check`, attemptedAt: DRIFT_AT,
    responsePayload: { drift: { attemptId: entityId, creditBatchId: "batch", creditBatchCode: "CB", differences: [] } },
    ...overrides,
  };
}

let client: Client;
let executor: typeof db;

describe.skipIf(!available)("batched Removal latest attempt PostgreSQL queries", () => {
  beforeEach(async () => {
    client = new Client({ connectionString: url, connectionTimeoutMillis: CONNECTION_TIMEOUT_MS });
    await client.connect();
    await client.query("begin");
    const config = getTableConfig(certifierSyncEvents);
    const columns = config.columns.map(column =>
      `${quote(column.name)} ${column.columnType === "PgEnumColumn" ? "text" : column.getSQLType()}`);
    await client.query(`create temporary table ${quote(config.name)} (${columns.join(", ")}) on commit drop`);
    executor = drizzle(client) as unknown as typeof db;
    vi.spyOn(db, "selectDistinctOn").mockImplementation(executor.selectDistinctOn.bind(executor));
    vi.spyOn(db, "select").mockImplementation(executor.select.bind(executor));
    await executor.insert(certifierSyncEvents).values([
      summary(ids.changed),
      summary(ids.laterFailure, { attemptedAt: OLDER, createdAt: OLDER }),
      summary(ids.laterFailure, { responsePayload: { failure_kind: "other" }, errorMessage: "Later failure" }),
      summary(ids.drift), drift(ids.drift),
      summary(ids.legacyDrift), drift(ids.legacyDrift, {
        responsePayload: { drift: { creditBatchId: "batch", creditBatchCode: "CB", differences: [] } },
      }),
      summary(ids.foreign, { organizationId: OTHER_ORG }),
    ]);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (client) { await client.query("rollback"); await client.end(); }
  });

  it("classifies the latest summary, gives drift precedence, and excludes another organization's Removal", async () => {
    const changed = await getRemovalIdsWithChangedLatestAttempt(ctx, Object.values(ids));
    expect(changed).toEqual(new Set([ids.changed]));
    expect(await getRemovalIdsWithChangedLatestAttempt({ ...ctx, organizationId: OTHER_ORG }, Object.values(ids)))
      .toEqual(new Set([ids.foreign]));
    // Older summaries cannot affect the outcome of the newest summary.
    // Check parity against the existing full-history read and classifier.
    for (const removalId of Object.values(ids)) {
      const history = await listRemovalAttemptEvents(ctx, { removalId });
      expect(changed.has(removalId)).toBe(deriveSubmissionAttempts(history)[0]?.outcome.kind === "changed");
    }
  });

  it("uses two queries for one or many Removals, including repeated ids", async () => {
    const single = await countQueries(() => getRemovalIdsWithChangedLatestAttempt(ctx, [ids.changed]));
    const many = await countQueries(() => getRemovalIdsWithChangedLatestAttempt(ctx, [...Object.values(ids), ids.changed]));
    expect(single.result).toEqual(new Set([ids.changed]));
    expect(many.result).toEqual(single.result);
    expect(single.queries).toBe(LOOKUP_QUERY_BUDGET);
    expect(many.queries).toBe(single.queries);
  });

  it("sends no queries for empty input and only one when there are no scoped summaries", async () => {
    const empty = await countQueries(() => getRemovalIdsWithChangedLatestAttempt(ctx, []));
    expect(empty).toEqual({ result: new Set(), queries: 0 });
    const missing = await countQueries(() => getRemovalIdsWithChangedLatestAttempt(ctx, [randomUUID(), ids.foreign]));
    expect(missing).toEqual({ result: new Set(), queries: 1 });
    await expect(getRemovalIdsWithChangedLatestAttempt({ ...ctx, organizationId: "" }, []))
      .rejects.toThrow();
  });

  it("filters drift by organization, entity type, operation, failed status and the oldest latest summary", async () => {
    await executor.insert(certifierSyncEvents).values([
      drift(ids.changed, { organizationId: OTHER_ORG }),
      drift(ids.changed, { entityType: "credit-batch" }),
      drift(ids.changed, { operation: "unrelated-operation" }),
      drift(ids.changed, { status: "succeeded" }),
      drift(ids.changed, { attemptedAt: OLDER, createdAt: OLDER }),
      // A newer event on another entity type must not replace the Removal summary.
      summary(ids.changed, { entityType: "credit-batch", attemptedAt: ATTEMPT_END, responsePayload: {} }),
    ]);
    expect(await getRemovalIdsWithChangedLatestAttempt(ctx, Object.values(ids))).toEqual(new Set([ids.changed]));
  });
});
