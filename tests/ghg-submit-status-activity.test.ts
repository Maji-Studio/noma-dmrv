import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, certificationSubmissions, certifierGhgStatements, facilities, organizations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { GhgStatement } from "@/lib/isometric";

// Keep ledger reads, status writes, and activity persistence real; stub the
// registry and unrelated report/session-lock dependencies of the submit core.
vi.mock("@/data-access/certifier-credentials", () => ({
  resolveIsometricClient: vi.fn(async () => ({})),
}));
vi.mock("@/data-access/facility-durability-lock", () => ({
  withFacilityDurabilitySessionLock: vi.fn(async (
    _ctx: OrgContext, _facilityId: string, run: () => Promise<unknown>,
  ) => run()),
}));
vi.mock("@/data-access/certification", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/data-access/certification")>(),
  attachReportDocument: vi.fn(async () => ({ id: crypto.randomUUID() })),
  appendSyncEvent: vi.fn(),
}));
vi.mock("@/lib/isometric", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/isometric")>(),
  getGhgStatement: vi.fn(),
  submitGhgStatement: vi.fn(),
  resubmitGhgStatement: vi.fn(),
}));

import * as registry from "@/lib/isometric";
import { submitGhgStatementToVerifierCore } from "@/fn/certification/submit-ghg-statement";
import { listEntityActivity } from "@/data-access/activity-events";

const REGISTRY_AT = "2026-10-14T10:00:00Z";
const REPORT_URL = "https://example.com/report.pdf";
const entityIds: string[] = [];
let ctx: OrgContext;
let facilityId: string;

beforeEach(async () => {
  vi.clearAllMocks();
  const id = `org_submit_activity_${crypto.randomUUID()}`;
  ctx = { organizationId: id, userId: "submit-actor", orgRole: "owner", isPlatformAdmin: false };
  await db.insert(organizations).values({ id, name: "Submit activity fixture", slug: id });
  facilityId = crypto.randomUUID();
  await db.insert(facilities).values({
    id: facilityId, organizationId: id, code: "ACTIVITY-TEST",
    name: "Submit activity facility", timezone: "UTC",
  });
});

afterEach(async () => {
  if (entityIds.length) {
    await db.delete(activityEvents).where(and(
      eq(activityEvents.organizationId, ctx.organizationId),
      inArray(activityEvents.entityId, entityIds),
    ));
    await db.delete(certificationSubmissions).where(and(
      eq(certificationSubmissions.organizationId, ctx.organizationId),
      inArray(certificationSubmissions.localEntityId, entityIds),
    ));
  }
  await db.delete(certifierGhgStatements).where(and(
    eq(certifierGhgStatements.organizationId, ctx.organizationId),
    inArray(certifierGhgStatements.id, entityIds),
  ));
  await db.delete(facilities).where(and(
    eq(facilities.organizationId, ctx.organizationId), eq(facilities.id, facilityId),
  ));
  await db.delete(organizations).where(eq(organizations.id, ctx.organizationId));
  entityIds.length = 0;
});

it.each(["submit", "resubmit", "reconciled"] as const)(
  "records user %s through the submit core as form activity",
  async (mode) => {
    const entityId = crypto.randomUUID();
    entityIds.push(entityId);
    await db.insert(certifierGhgStatements).values({
      id: entityId, organizationId: ctx.organizationId, facilityId,
      reportingPeriodEndOn: "2026-10-14",
    });
    const externalId = `ghg_${entityId}`;
    const fromRemote = mode === "resubmit" ? "FAILED_VERIFICATION" : "DRAFT";
    const fromStatus = mode === "resubmit" ? "rejected" : "submitted";
    await db.insert(certificationSubmissions).values({
      organizationId: ctx.organizationId, localEntityType: "ghgStatement",
      localEntityId: entityId, submissionType: "ghg_statement",
      status: fromStatus, externalId, metadata: { remoteStatus: fromRemote },
    });
    const remoteAfter: GhgStatement = {
      id: externalId, project_id: "prj_fixture", status: "AWAITING_VERIFICATION",
      verifier: null, removal_ids: [], credit_allocation: null,
      ghg_statement_report_url: REPORT_URL, pending_total_co2e_removed_kg: null,
      submitted_at: REGISTRY_AT, credits_issued_at: null, ghg_entry_ids: ["entry_fixture"],
      reporting_period_start_at: null, reporting_period_end_at: null,
    };
    vi.mocked(registry.getGhgStatement).mockResolvedValue(mode === "reconciled"
      ? remoteAfter : { ...remoteAfter, status: fromRemote, submitted_at: null });
    vi.mocked(registry.submitGhgStatement).mockResolvedValue(remoteAfter);
    vi.mocked(registry.resubmitGhgStatement).mockResolvedValue(remoteAfter);

    await expect(submitGhgStatementToVerifierCore({
      orgCtx: ctx, ghgStatementId: entityId,
      input: { externalReportUrl: REPORT_URL, summaryOfChanges: "Updated report", confirmProduction: true },
    })).resolves.toEqual({ externalId: remoteAfter.id, remoteStatus: remoteAfter.status });

    const history = await listEntityActivity(ctx, "ghg_statement", entityId);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      source: "form", actorUserId: ctx.userId, registryAt: new Date(REGISTRY_AT),
      fromStatus, toStatus: "submitted", fromRemote, toRemote: "AWAITING_VERIFICATION",
    });
    expect(registry.submitGhgStatement).toHaveBeenCalledTimes(mode === "submit" ? 1 : 0);
    expect(registry.resubmitGhgStatement).toHaveBeenCalledTimes(mode === "resubmit" ? 1 : 0);
  },
);
