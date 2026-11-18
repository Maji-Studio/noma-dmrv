/**
 * Display state of the Removals holding a credit batch's slices, for surfaces
 * that list batches (dashboard Needs attention, batch to-dos). It feeds the
 * same `deriveSubmissionStatus` the Removals list and the batch page use, so
 * "Submission interrupted" reads the same everywhere (#1528). Display only:
 * nothing here gates a submission, retry or recovery.
 *
 * The facts ride as correlated subqueries on the caller's batch select, so a
 * list of batches costs no extra round trip.
 */
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { certificationSubmissions, certifierRemovals, creditBatchApplications, creditBatches } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import {
  deriveSubmissionStatus,
  hasSubmittedRemovalVersion,
  type SubmissionDisplayFacts,
} from "@/lib/certification/from-submission";
import type { DerivedStatus } from "@/lib/certification/status";
import { isLockedInFlight } from "@/lib/isometric/utils/lock";
import { epochMs } from "./dashboard-stations";
import { requireOrgScope } from "./utils";

/** The latest attempt's display facts; the payload carries only its reporting window. */
export type RemovalDisplaySubmission = SubmissionDisplayFacts & { lockedAtMs: number | null };

export interface BatchRemovalDisplayFacts {
  id: string;
  code: string;
  startedOn: string | null;
  completedOn: string | null;
  /** The Removal's current GHG Statement, for the dashboard's returned-Removal lineage read. */
  ghgStatementId: string | null;
  submission: RemovalDisplaySubmission | null;
  /** Every submitted, accepted or superseded version, for the phase the batch page reads. */
  submittedVersions: SubmissionDisplayFacts[];
}

export interface RemovalDisplay {
  id: string;
  code: string;
  status: DerivedStatus;
  /** As on the batch page: a newer draft does not undo an earlier submitted version. */
  phase: "draft" | "submitted";
}

/** The outer `certifier_removals` row's Isometric Removal versions; callers add the org predicate. */
function outerRemovalVersions(...extra: SQL[]) {
  return and(
    eq(certificationSubmissions.localEntityId, certifierRemovals.id),
    eq(certificationSubmissions.provider, "isometric"),
    eq(certificationSubmissions.localEntityType, "removal"),
    eq(certificationSubmissions.submissionType, "removal"),
    ...extra,
  );
}

/** The display facts of one version; the payload carries only its reporting window. */
const versionFactsSql = sql`
  'status', ${certificationSubmissions.status},
  'externalId', ${certificationSubmissions.externalId},
  'metadata', ${certificationSubmissions.metadata},
  'payloadSnapshot', jsonb_build_object('semantic', jsonb_build_object(
    'startedOn', ${certificationSubmissions.payloadSnapshot} -> 'semantic' -> 'startedOn',
    'completedOn', ${certificationSubmissions.payloadSnapshot} -> 'semantic' -> 'completedOn'))`;

/**
 * The latest Isometric Removal attempt of the outer `certifier_removals` row.
 * `locked_at` travels as epoch ms: a zone-less timestamp inside JSON would
 * parse as local time.
 */
function latestRemovalDisplaySubmissionSql(ctx: OrgContext) {
  requireOrgScope(ctx);
  const latest = db.select({
    value: sql<RemovalDisplaySubmission>`jsonb_build_object(
      'lockedAtMs', ${epochMs(certificationSubmissions.lockedAt)}, ${versionFactsSql})`,
  }).from(certificationSubmissions).where(and(
    eq(certificationSubmissions.organizationId, ctx.organizationId),
    outerRemovalVersions(),
  ))
    .orderBy(sql`${certificationSubmissions.version} desc`).limit(1);
  return sql<RemovalDisplaySubmission | null>`(${latest})`;
}

/** Every submitted, accepted or superseded version of the outer `certifier_removals` row. */
function submittedRemovalVersionsSql(ctx: OrgContext) {
  requireOrgScope(ctx);
  const versions = db.select({
    value: sql<SubmissionDisplayFacts[]>`coalesce(jsonb_agg(jsonb_build_object(${versionFactsSql})), '[]'::jsonb)`,
  }).from(certificationSubmissions).where(and(
    eq(certificationSubmissions.organizationId, ctx.organizationId),
    outerRemovalVersions(inArray(certificationSubmissions.status, ["submitted", "accepted", "superseded"])),
  ));
  return sql<SubmissionDisplayFacts[]>`(${versions})`;
}

/** Every Removal holding a slice of the outer, org-scoped `credit_batches` row. */
export function batchRemovalDisplayFactsSql(ctx: OrgContext) {
  requireOrgScope(ctx);
  const latest = latestRemovalDisplaySubmissionSql(ctx);
  const submittedVersions = submittedRemovalVersionsSql(ctx);
  const holders = db.select({
    value: sql<BatchRemovalDisplayFacts[]>`coalesce(jsonb_agg(distinct jsonb_build_object(
      'id', ${certifierRemovals.id}, 'code', ${certifierRemovals.code},
      'startedOn', ${certifierRemovals.startedOn}, 'completedOn', ${certifierRemovals.completedOn},
      'ghgStatementId', ${certifierRemovals.ghgStatementId},
      'submission', (${latest}),
      'submittedVersions', (${submittedVersions})
    )), '[]'::jsonb)`,
  }).from(creditBatchApplications).innerJoin(certifierRemovals, and(
    eq(certifierRemovals.id, creditBatchApplications.removalId),
    eq(certifierRemovals.organizationId, ctx.organizationId),
    eq(certifierRemovals.facilityId, creditBatches.facilityId),
  )).where(and(
    eq(creditBatchApplications.organizationId, ctx.organizationId),
    eq(creditBatchApplications.creditBatchId, creditBatches.id),
  ));
  return sql<BatchRemovalDisplayFacts[]>`(${holders})`;
}

export function removalDisplayFromFacts(row: BatchRemovalDisplayFacts): RemovalDisplay {
  const latest = row.submission;
  const lockedAt = latest?.lockedAtMs == null ? null : new Date(Number(latest.lockedAtMs));
  const inFlight = latest ? isLockedInFlight({ status: latest.status, lockedAt }) : false;
  const window = { startedOn: row.startedOn, completedOn: row.completedOn };
  return {
    id: row.id,
    code: row.code,
    status: deriveSubmissionStatus(latest, inFlight, "removal", window),
    phase: hasSubmittedRemovalVersion(row.submittedVersions, window) ? "submitted" : "draft",
  };
}

/** Each batch's holding Removals with their display state, in one statement. */
export async function loadCreditBatchRemovalDisplays(ctx: OrgContext, ids: readonly string[]): Promise<Map<string, RemovalDisplay[]>> {
  requireOrgScope(ctx);
  if (!ids.length) return new Map();
  const rows = await db.select({ id: creditBatches.id, removals: batchRemovalDisplayFactsSql(ctx) })
    .from(creditBatches).where(and(eq(creditBatches.organizationId, ctx.organizationId), inArray(creditBatches.id, [...ids])));
  return new Map(rows.map(row => [row.id, row.removals.map(removalDisplayFromFacts)]));
}
