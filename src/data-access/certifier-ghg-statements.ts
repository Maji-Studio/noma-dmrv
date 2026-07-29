import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import { countRows } from "@/db/aggregate";
import { isPgUniqueViolation } from "@/db/errors";
import {
  CERTIFIER_GHG_STATEMENT_REMOTE_EXTERNAL_ID_METADATA_KEY,
  certifierGhgStatements,
  certifierProjects,
  certifierRemovals,
  certificationSubmissions,
} from "@/db/schema/certification";
import { SafeError } from "@/lib/errors";
import { LOCK_TTL_MS } from "@/lib/isometric/utils/lock";
import { decideRemovalMembership } from "@/lib/isometric/utils/ghg-entry-membership";
import {
  GHG_STATEMENT_ENTITY_TYPE,
  GHG_STATEMENT_SUBMISSION_TYPE,
} from "@/lib/isometric/utils/constants";
import {
  chooseStoredRemotePeriodEnd,
} from "@/lib/isometric/utils/ghg-statement-local-period";
import type { CertificationSubmissionRow, Tx } from "./certification";
import type { OrgContext } from "@/lib/auth/server";
import { assertSameOrg, requireOrgScope } from "./utils";
import type { CertifierRemovalRow } from "./certifier-removals";

export type CertifierGhgStatementRow =
  typeof certifierGhgStatements.$inferSelect;

const ISOMETRIC = "isometric" as const;
const REMOTE_PERIOD_INSERT_RETRY_LIMIT = 10;
// Per-(organization, facility) registry-identity index (ADR 0023). Matched by
// name so a 23505 on it is never confused with the period constraint.
const REMOTE_EXTERNAL_ID_UNIQUE_CONSTRAINT =
  "certifier_ghg_statements_remote_external_id_unique";
export const REMOTE_EXTERNAL_ID_METADATA_KEY =
  CERTIFIER_GHG_STATEMENT_REMOTE_EXTERNAL_ID_METADATA_KEY;
export const REMOTE_PERIOD_MISSING_METADATA_KEY = "remotePeriodMissing";
export const REMOTE_PERIOD_END_ON_METADATA_KEY = "remotePeriodEndOn";
export const REMOTE_PERIOD_END_IS_SYNTHETIC_METADATA_KEY =
  "remotePeriodEndIsSynthetic";

export function hasMissingRemotePeriod(
  statement: Pick<CertifierGhgStatementRow, "metadata">,
): boolean {
  return (
    typeof statement.metadata === "object" &&
    statement.metadata !== null &&
    REMOTE_PERIOD_MISSING_METADATA_KEY in statement.metadata &&
    (
      statement.metadata as Record<string, unknown>
    )[REMOTE_PERIOD_MISSING_METADATA_KEY] === true
  );
}

export function getEffectiveReportingPeriodEndOn(
  statement: Pick<
    CertifierGhgStatementRow,
    "metadata" | "reportingPeriodEndOn"
  >,
): string {
  const remoteEndOn = metadataValue(
    statement,
    REMOTE_PERIOD_END_ON_METADATA_KEY,
  );
  return typeof remoteEndOn === "string"
    ? remoteEndOn
    : statement.reportingPeriodEndOn;
}

function metadataValue(
  statement: Pick<CertifierGhgStatementRow, "metadata">,
  key: string,
): unknown {
  return typeof statement.metadata === "object" &&
    statement.metadata !== null &&
    key in statement.metadata
    ? (statement.metadata as Record<string, unknown>)[key]
    : undefined;
}

export async function getCertifierGhgStatementById(
  ctx: OrgContext,
  id: string,
): Promise<CertifierGhgStatementRow | null> {
  requireOrgScope(ctx);
  const [row] = await db
    .select()
    .from(certifierGhgStatements)
    .where(and(eq(certifierGhgStatements.id, id), eq(certifierGhgStatements.organizationId, ctx.organizationId)))
    .limit(1);
  return row ?? null;
}

export async function listGhgStatementsForFacility(
  ctx: OrgContext,
  facilityId: string,
): Promise<CertifierGhgStatementRow[]> {
  requireOrgScope(ctx);
  return db
    .select()
    .from(certifierGhgStatements)
    .where(and(eq(certifierGhgStatements.facilityId, facilityId), eq(certifierGhgStatements.organizationId, ctx.organizationId)))
    .orderBy(desc(certifierGhgStatements.createdAt));
}

export async function listFacilityIdsForExternalRemovals(
  ctx: OrgContext,
  externalRemovalIds: string[],
): Promise<string[]> {
  requireOrgScope(ctx);
  if (externalRemovalIds.length === 0) return [];
  const rows = await db
    .select({ facilityId: certifierRemovals.facilityId })
    .from(certificationSubmissions)
    .innerJoin(
      certifierRemovals,
      and(
        eq(certificationSubmissions.localEntityId, certifierRemovals.id),
        eq(certifierRemovals.organizationId, ctx.organizationId),
      ),
    )
    .where(
      and(
        eq(certificationSubmissions.provider, ISOMETRIC),
        eq(certificationSubmissions.submissionType, "removal"),
        eq(certificationSubmissions.localEntityType, "removal"),
        inArray(certificationSubmissions.externalId, externalRemovalIds),
        eq(certificationSubmissions.organizationId, ctx.organizationId),
      ),
    );
  return [...new Set(rows.map((row) => row.facilityId))];
}

export async function listFacilityIdsForExternalProject(
  ctx: OrgContext,
  externalProjectId: string,
): Promise<string[]> {
  requireOrgScope(ctx);
  const rows = await db
    .select({ facilityId: certifierProjects.facilityId })
    .from(certifierProjects)
    .where(
      and(
        eq(certifierProjects.provider, ISOMETRIC),
        eq(certifierProjects.externalProjectId, externalProjectId),
        eq(certifierProjects.organizationId, ctx.organizationId),
      ),
    );
  return rows.map((row) => row.facilityId);
}

// The ledger row a *specific* facility holds for a registry statement id.
//
// Statement identity is scoped per (organization, facility) since ADR 0023, so
// the generic `getSubmissionByExternalId` is ambiguous for GHG statements: two
// facilities sharing one Isometric project each keep their own local row and
// their own ledger row for the same `remote.id`. Every GHG reconcile path must
// ask "does THIS facility already hold this remote statement?" rather than
// "does anyone?".
export async function getGhgStatementSubmissionForFacility(
  ctx: OrgContext,
  args: { facilityId: string; externalId: string },
): Promise<CertificationSubmissionRow | null> {
  requireOrgScope(ctx);
  const [row] = await db
    .select({ submission: certificationSubmissions })
    .from(certificationSubmissions)
    .innerJoin(
      certifierGhgStatements,
      and(
        eq(
          certificationSubmissions.localEntityId,
          certifierGhgStatements.id,
        ),
        eq(certifierGhgStatements.organizationId, ctx.organizationId),
      ),
    )
    .where(
      and(
        eq(certificationSubmissions.provider, ISOMETRIC),
        eq(
          certificationSubmissions.submissionType,
          GHG_STATEMENT_SUBMISSION_TYPE,
        ),
        eq(
          certificationSubmissions.localEntityType,
          GHG_STATEMENT_ENTITY_TYPE,
        ),
        eq(certificationSubmissions.externalId, args.externalId),
        eq(certifierGhgStatements.facilityId, args.facilityId),
        eq(certificationSubmissions.organizationId, ctx.organizationId),
      ),
    )
    .orderBy(desc(certificationSubmissions.version))
    .limit(1);
  return row?.submission ?? null;
}

export async function hasInFlightGhgStatementForFacility(
  ctx: OrgContext,
  facilityId: string,
): Promise<boolean> {
  requireOrgScope(ctx);
  const [row] = await db
    .select({ id: certificationSubmissions.id })
    .from(certificationSubmissions)
    .innerJoin(
      certifierGhgStatements,
      and(
        eq(
          certificationSubmissions.localEntityId,
          certifierGhgStatements.id,
        ),
        eq(certifierGhgStatements.organizationId, ctx.organizationId),
      ),
    )
    .where(
      and(
        eq(certificationSubmissions.provider, ISOMETRIC),
        eq(
          certificationSubmissions.submissionType,
          GHG_STATEMENT_SUBMISSION_TYPE,
        ),
        eq(
          certificationSubmissions.localEntityType,
          GHG_STATEMENT_ENTITY_TYPE,
        ),
        eq(certificationSubmissions.status, "draft"),
        isNotNull(certificationSubmissions.lockedAt),
        gt(
          certificationSubmissions.lockedAt,
          new Date(Date.now() - LOCK_TTL_MS),
        ),
        eq(certifierGhgStatements.facilityId, facilityId),
        eq(certificationSubmissions.organizationId, ctx.organizationId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export interface GetOrCreateGhgStatementResult {
  statement: CertifierGhgStatementRow;
  // false when an existing row for this (provider, facility, period) was
  // returned instead of a fresh insert.
  created: boolean;
}

// Returns the local GHG-statement row for (provider, facility, period) —
// inserting one if none exists — before any Isometric call. The id is stable
// per period: it becomes the ledger row's localEntityId, so a repeat create
// (double-click, two tabs) finds the prior ledger row and the
// submission-claim machinery resolves the race instead of minting a second
// Isometric registry artifact (ADR 0004). The insert-then-select is
// race-safe behind the certifier_ghg_statements_facility_period_unique
// constraint — a losing concurrent insert hits the conflict and falls
// through to the select.
export async function getOrCreateGhgStatementDraft(
  ctx: OrgContext,
  input: { facilityId: string; reportingPeriodEndOn: string },
): Promise<GetOrCreateGhgStatementResult> {
  requireOrgScope(ctx);
  const [inserted] = await db
    .insert(certifierGhgStatements)
    .values({
      organizationId: ctx.organizationId,
      facilityId: input.facilityId,
      reportingPeriodEndOn: input.reportingPeriodEndOn,
    })
    .onConflictDoNothing({
      target: [
        certifierGhgStatements.provider,
        certifierGhgStatements.facilityId,
        certifierGhgStatements.reportingPeriodEndOn,
      ],
    })
    .returning();
  if (inserted) return { statement: inserted, created: true };

  const [existing] = await db
    .select()
    .from(certifierGhgStatements)
    .where(
      and(
        eq(certifierGhgStatements.provider, ISOMETRIC),
        eq(certifierGhgStatements.facilityId, input.facilityId),
        eq(
          certifierGhgStatements.reportingPeriodEndOn,
          input.reportingPeriodEndOn,
        ),
        eq(certifierGhgStatements.organizationId, ctx.organizationId),
      ),
    )
    .limit(1);
  if (!existing) {
    // The insert hit the conflict target but the select found nothing — only
    // reachable if the conflicting row was deleted between the two
    // statements. There is no soft/hard delete for GHG statements today, so
    // this is effectively unreachable; surface a retryable error rather than
    // returning undefined.
    throw new SafeError("The GHG Statement was not created. Try again.");
  }
  return { statement: existing, created: false };
}

/**
 * Creates a distinct local identity for a registry-discovered statement.
 * Unlike operator creation, registry identity is the external statement ID,
 * not its period: the registry permits duplicate and null periods.
 */
export async function createGhgStatementForRegistryDiscovery(
  ctx: OrgContext,
  input: {
    facilityId: string;
    externalId: string;
    reportingPeriodEndOn: string | null;
  },
): Promise<CertifierGhgStatementRow> {
  requireOrgScope(ctx);
  const existing = await findRegistryDiscoveryStatement(
    ctx,
    input.facilityId,
    input.externalId,
  );
  if (existing) return existing;

  // A stale operator create may have POSTed successfully before persisting
  // the returned registry id. Once its lock expires, adopt that unbound
  // same-period identity rather than allocating a synthetic duplicate.
  const adoptable = await findAdoptableOperatorStatement(ctx, input);
  if (adoptable) return adoptable;

  const occupiedEndOns = await listStoredPeriodEnds(ctx, input.facilityId);

  for (
    let attempt = 0;
    attempt < REMOTE_PERIOD_INSERT_RETRY_LIMIT;
    attempt += 1
  ) {
    const storedPeriod = chooseStoredRemotePeriodEnd(
      input.reportingPeriodEndOn,
      occupiedEndOns,
    );
    // Two unique keys can reject this insert and they mean opposite things,
    // but Postgres allows only ONE inference target per ON CONFLICT. So the
    // *period* key (the retryable one — another remote already occupies this
    // local date, pick another) is the explicit target, and the per-facility
    // *external-id* key (a concurrent reconcile of this same remote won the
    // race) is caught by name and resolved by re-reading. Nothing is swallowed
    // untargeted: any other violation propagates.
    let inserted: CertifierGhgStatementRow | undefined;
    try {
      [inserted] = await db
        .insert(certifierGhgStatements)
        .values({
          organizationId: ctx.organizationId,
          facilityId: input.facilityId,
          reportingPeriodEndOn: storedPeriod.endOn,
          metadata: {
            [REMOTE_EXTERNAL_ID_METADATA_KEY]: input.externalId,
            [REMOTE_PERIOD_END_ON_METADATA_KEY]: input.reportingPeriodEndOn,
            [REMOTE_PERIOD_END_IS_SYNTHETIC_METADATA_KEY]:
              storedPeriod.synthetic,
            [REMOTE_PERIOD_MISSING_METADATA_KEY]:
              input.reportingPeriodEndOn === null,
          },
        })
        .onConflictDoNothing({
          target: [
            certifierGhgStatements.provider,
            certifierGhgStatements.facilityId,
            certifierGhgStatements.reportingPeriodEndOn,
          ],
        })
        .returning();
    } catch (err) {
      if (!isPgUniqueViolation(err, REMOTE_EXTERNAL_ID_UNIQUE_CONSTRAINT)) {
        throw err;
      }
    }
    if (inserted) return inserted;
    const concurrentlyInserted = await findRegistryDiscoveryStatement(
      ctx,
      input.facilityId,
      input.externalId,
    );
    if (concurrentlyInserted) return concurrentlyInserted;
    occupiedEndOns.add(storedPeriod.endOn);
  }

  throw new SafeError(
    "The registry GHG Statement could not be synced. Refresh the page and try again.",
  );
}

async function findAdoptableOperatorStatement(
  ctx: OrgContext,
  input: {
    facilityId: string;
    externalId: string;
    reportingPeriodEndOn: string | null;
  },
): Promise<CertifierGhgStatementRow | null> {
  if (input.reportingPeriodEndOn === null) return null;
  const [candidate] = await db
    .select()
    .from(certifierGhgStatements)
    .where(
      and(
        eq(certifierGhgStatements.provider, ISOMETRIC),
        eq(certifierGhgStatements.facilityId, input.facilityId),
        eq(
          certifierGhgStatements.reportingPeriodEndOn,
          input.reportingPeriodEndOn,
        ),
        eq(certifierGhgStatements.organizationId, ctx.organizationId),
      ),
    )
    .limit(1);
  if (
    !candidate ||
    metadataValue(candidate, REMOTE_EXTERNAL_ID_METADATA_KEY) !== undefined
  ) {
    return null;
  }
  const [latest] = await db
    .select({
      externalId: certificationSubmissions.externalId,
      status: certificationSubmissions.status,
      lockedAt: certificationSubmissions.lockedAt,
    })
    .from(certificationSubmissions)
    .where(
      and(
        eq(certificationSubmissions.provider, ISOMETRIC),
        eq(
          certificationSubmissions.submissionType,
          GHG_STATEMENT_SUBMISSION_TYPE,
        ),
        eq(
          certificationSubmissions.localEntityType,
          GHG_STATEMENT_ENTITY_TYPE,
        ),
        eq(certificationSubmissions.localEntityId, candidate.id),
        eq(certificationSubmissions.organizationId, ctx.organizationId),
      ),
    )
    .orderBy(desc(certificationSubmissions.version))
    .limit(1);
  if (!latest) return candidate;
  const activeLock =
    latest.status === "draft" &&
    latest.lockedAt !== null &&
    Date.now() - latest.lockedAt.getTime() < LOCK_TTL_MS;
  return latest.externalId === null && !activeLock ? candidate : null;
}

async function findRegistryDiscoveryStatement(
  ctx: OrgContext,
  facilityId: string,
  externalId: string,
): Promise<CertifierGhgStatementRow | null> {
  requireOrgScope(ctx);
  const rows = await db
    .select()
    .from(certifierGhgStatements)
    .where(
      and(
        eq(certifierGhgStatements.provider, ISOMETRIC),
        eq(certifierGhgStatements.facilityId, facilityId),
        eq(
          certifierGhgStatements.organizationId,
          ctx.organizationId,
        ),
      ),
    );
  return (
    rows.find(
      (row) =>
        metadataValue(row, REMOTE_EXTERNAL_ID_METADATA_KEY) === externalId,
    ) ?? null
  );
}

// Persists the server-derived reporting-period start after the statement is
// created in Isometric (the create API derives it; we cannot set it).
export async function updateGhgStatementReportingWindow(
  ctx: OrgContext,
  id: string,
  args: {
    reportingPeriodStartOn: string | null;
    reportingPeriodEndOn?: string | null;
    remotePeriodMissing?: boolean;
  },
  tx?: Tx,
): Promise<void> {
  requireOrgScope(ctx);
  const executor = tx ?? db;
  const [statement] = await executor
    .select()
    .from(certifierGhgStatements)
    .where(
      and(
        eq(certifierGhgStatements.id, id),
        eq(certifierGhgStatements.organizationId, ctx.organizationId),
      ),
    )
    .limit(1);
  if (!statement) {
    throw new SafeError("GHG Statement not found.");
  }

  const metadataPatch: Record<string, unknown> = {};
  let reportingPeriodEndOn = statement.reportingPeriodEndOn;
  if (args.reportingPeriodEndOn !== undefined) {
    const occupiedEndOns = await listStoredPeriodEnds(
      ctx,
      statement.facilityId,
      executor,
      statement.id,
    );
    const storedPeriod = chooseStoredRemotePeriodEnd(
      args.reportingPeriodEndOn,
      occupiedEndOns,
    );
    reportingPeriodEndOn = storedPeriod.endOn;
    metadataPatch[REMOTE_PERIOD_END_ON_METADATA_KEY] =
      args.reportingPeriodEndOn;
    metadataPatch[REMOTE_PERIOD_END_IS_SYNTHETIC_METADATA_KEY] =
      storedPeriod.synthetic;
  }
  if (args.remotePeriodMissing !== undefined) {
    metadataPatch[REMOTE_PERIOD_MISSING_METADATA_KEY] =
      args.remotePeriodMissing;
  }

  await executor
    .update(certifierGhgStatements)
    .set({
      reportingPeriodStartOn: args.reportingPeriodStartOn,
      reportingPeriodEndOn,
      metadata: sql`coalesce(${certifierGhgStatements.metadata}, '{}'::jsonb) || ${JSON.stringify(metadataPatch)}::jsonb`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(certifierGhgStatements.id, id), eq(certifierGhgStatements.organizationId, ctx.organizationId)));
}

async function listStoredPeriodEnds(
  ctx: OrgContext,
  facilityId: string,
  executor: Tx | typeof db = db,
  excludeStatementId?: string,
): Promise<Set<string>> {
  requireOrgScope(ctx);
  const rows = await executor
    .select({
      id: certifierGhgStatements.id,
      endOn: certifierGhgStatements.reportingPeriodEndOn,
    })
    .from(certifierGhgStatements)
    .where(
      and(
        eq(certifierGhgStatements.provider, ISOMETRIC),
        eq(certifierGhgStatements.facilityId, facilityId),
        eq(
          certifierGhgStatements.organizationId,
          ctx.organizationId,
        ),
      ),
    );
  return new Set(
    rows.flatMap((row) =>
      row.id === excludeStatementId ? [] : [row.endOn],
    ),
  );
}

export async function getRemovalsByGhgStatementId(
  ctx: OrgContext,
  ghgStatementId: string,
): Promise<CertifierRemovalRow[]> {
  requireOrgScope(ctx);
  await assertSameOrg(ctx, certifierGhgStatements, ghgStatementId);
  return db
    .select()
    .from(certifierRemovals)
    .where(and(eq(certifierRemovals.ghgStatementId, ghgStatementId), eq(certifierRemovals.organizationId, ctx.organizationId)))
    .orderBy(desc(certifierRemovals.completedOn));
}

// Batched linked-removal counts for a set of GHG statements — one grouped
// query instead of one getRemovalsByGhgStatementId per statement. Returns a
// ghgStatementId → count map; statements with no removals are simply absent.
export async function countRemovalsByGhgStatementIds(
  ctx: OrgContext,
  ghgStatementIds: string[],
): Promise<Map<string, number>> {
  requireOrgScope(ctx);
  if (ghgStatementIds.length === 0) return new Map();
  const rows = await db
    .select({
      ghgStatementId: certifierRemovals.ghgStatementId,
      count: countRows(),
    })
    .from(certifierRemovals)
    .where(and(inArray(certifierRemovals.ghgStatementId, ghgStatementIds), eq(certifierRemovals.organizationId, ctx.organizationId)))
    .groupBy(certifierRemovals.ghgStatementId);
  return new Map(
    rows.flatMap((row) =>
      row.ghgStatementId ? [[row.ghgStatementId, row.count] as const] : [],
    ),
  );
}

export interface OpenRemoval {
  removal: CertifierRemovalRow;
  // The Isometric Removal id from the removal's latest ledger row.
  externalId: string;
}

// "Open removals" — removals already submitted to Isometric (their latest
// ledger row carries a remote externalId) and not yet absorbed by any GHG
// Statement (ghgStatementId IS NULL). Feeds the GHG-statement stepper
// preview. "Latest" means highest ledger version, the same rule as
// getLatestSubmission.
export async function listOpenRemovalsForFacility(
  ctx: OrgContext,
  facilityId: string,
): Promise<OpenRemoval[]> {
  requireOrgScope(ctx);
  const latest = db
    .selectDistinctOn([certificationSubmissions.localEntityId], {
      removalId: certificationSubmissions.localEntityId,
      externalId: certificationSubmissions.externalId,
    })
    .from(certificationSubmissions)
    .where(
      and(
        eq(certificationSubmissions.provider, ISOMETRIC),
        eq(certificationSubmissions.submissionType, "removal"),
        eq(certificationSubmissions.localEntityType, "removal"),
        eq(certificationSubmissions.organizationId, ctx.organizationId),
      ),
    )
    .orderBy(
      certificationSubmissions.localEntityId,
      desc(certificationSubmissions.version),
    )
    .as("latest_removal_submission");

  const rows = await db
    .select({
      removal: certifierRemovals,
      externalId: latest.externalId,
    })
    .from(certifierRemovals)
    .innerJoin(latest, eq(latest.removalId, certifierRemovals.id))
    .where(
      and(
        eq(certifierRemovals.facilityId, facilityId),
        isNull(certifierRemovals.ghgStatementId),
        isNotNull(latest.externalId),
        eq(certifierRemovals.organizationId, ctx.organizationId),
      ),
    )
    .orderBy(desc(certifierRemovals.completedOn));

  // The isNotNull filter above guarantees externalId is present; narrow it.
  return rows.flatMap((r) =>
    r.externalId === null
      ? []
      : [{ removal: r.removal, externalId: r.externalId }],
  );
}

export interface ReconcileResult {
  // Local removal ids now linked to this statement (newly stamped or
  // already linked to it).
  linkedRemovalIds: string[];
  // Human-readable drift notes — unmatched Isometric removals, or removals
  // already owned by a different statement.
  warnings: string[];
}

// Reconciles a GHG Statement's server-side removal membership onto local
// rows. Isometric decides membership by reporting-period date range and
// returns `ghg_entry_ids`; this maps each back to its local certifier_removals
// row and stamps ghg_statement_id. It never steals a removal already linked
// to a different statement — the FOR UPDATE read + IS NULL guard make the
// link decision and the write atomic.
export async function reconcileRemovalMembership(
  ctx: OrgContext,
  ghgStatementId: string,
  externalRemovalIds: string[],
  tx?: Tx,
  mode: "full" | "unlink-only" = "full",
): Promise<ReconcileResult> {
  requireOrgScope(ctx);
  const run = async (tx: Tx): Promise<ReconcileResult> => {
    // 0. Resolve the target statement's facility so every subsequent step
    //    refuses to stamp a removal that lives in a different facility.
    //    Defence in depth — Isometric's `ghg_entry_ids` should already be
    //    facility-scoped (its project owns a single noma facility), but a
    //    registry bug, misconfiguration, or external_id collision must
    //    never let the stamp cross facility boundaries.
    const [target] = await tx
      .select({ facilityId: certifierGhgStatements.facilityId })
      .from(certifierGhgStatements)
      .where(and(eq(certifierGhgStatements.id, ghgStatementId), eq(certifierGhgStatements.organizationId, ctx.organizationId)))
      .limit(1);
    if (!target) {
      throw new SafeError("GHG Statement not found. Refresh the page.");
    }
    const targetFacilityId = target.facilityId;

    // 1. Map each Isometric removal id → its local removal id via the
    //    ledger. externalId is unique per (provider, submissionType).
    const ledgerRows = await tx
      .select({
        localRemovalId: certificationSubmissions.localEntityId,
        externalId: certificationSubmissions.externalId,
      })
      .from(certificationSubmissions)
      .where(
        and(
          eq(certificationSubmissions.provider, ISOMETRIC),
          eq(certificationSubmissions.submissionType, "removal"),
          eq(certificationSubmissions.localEntityType, "removal"),
          inArray(certificationSubmissions.externalId, externalRemovalIds),
          eq(certificationSubmissions.organizationId, ctx.organizationId),
        ),
      );

    const externalToLocal = new Map<string, string>();
    for (const row of ledgerRows) {
      if (row.externalId) {
        externalToLocal.set(row.externalId, row.localRemovalId);
      }
    }

    // 2. Lock both candidates and removals currently owned by this statement.
    //    The latter lets registry membership shrink authoritatively, including
    //    to an empty set, without touching another statement's members.
    const candidateIds = [...new Set(externalToLocal.values())];
    const currentMembership = new Map<string, string | null>();
    const current = await tx
      .select({
        id: certifierRemovals.id,
        facilityId: certifierRemovals.facilityId,
        ghgStatementId: certifierRemovals.ghgStatementId,
      })
      .from(certifierRemovals)
      .where(
        and(
          or(
            candidateIds.length > 0
              ? inArray(certifierRemovals.id, candidateIds)
              : undefined,
            eq(certifierRemovals.ghgStatementId, ghgStatementId),
          ),
          eq(certifierRemovals.organizationId, ctx.organizationId),
        ),
      )
      .for("update");
    for (const r of current) {
      if (r.facilityId !== targetFacilityId) {
        // Drop the mapping so decideRemovalMembership never sees an
        // out-of-facility candidate. The corresponding external id falls
        // through to the "no local record" warning path.
        for (const [extId, localId] of externalToLocal) {
          if (localId === r.id) externalToLocal.delete(extId);
        }
        continue;
      }
      currentMembership.set(r.id, r.ghgStatementId);
    }

    // 3. Pure decision — what to link, what to warn about. No steal.
    const decision = decideRemovalMembership({
      externalRemovalIds,
      externalToLocal,
      currentMembership,
      ghgStatementId,
    });

    // 4. Stamp ghg_statement_id on the unlinked removals. The IS NULL guard
    //    is redundant under the FOR UPDATE lock but kept as belt-and-braces.
    //    The facilityId predicate mirrors step 0 so the write itself cannot
    //    cross facility boundaries even if the in-memory filter slipped.
    if (mode === "full" && decision.toLink.length > 0) {
      await tx
        .update(certifierRemovals)
        .set({ ghgStatementId, updatedAt: sql`now()` })
        .where(
          and(
            inArray(certifierRemovals.id, decision.toLink),
            eq(certifierRemovals.facilityId, targetFacilityId),
            isNull(certifierRemovals.ghgStatementId),
            eq(certifierRemovals.organizationId, ctx.organizationId),
          ),
        );
    }

    const linkedSet = new Set(decision.linkedRemovalIds);
    const toUnlink = current
      .filter(
        (removal) =>
          removal.ghgStatementId === ghgStatementId &&
          !linkedSet.has(removal.id),
      )
      .map((removal) => removal.id);
    if (toUnlink.length > 0) {
      await tx
        .update(certifierRemovals)
        .set({ ghgStatementId: null, updatedAt: sql`now()` })
        .where(
          and(
            inArray(certifierRemovals.id, toUnlink),
            eq(certifierRemovals.ghgStatementId, ghgStatementId),
            eq(certifierRemovals.organizationId, ctx.organizationId),
          ),
        );
    }

    return {
      linkedRemovalIds: decision.linkedRemovalIds,
      warnings: decision.warnings,
    };
  };

  // Join the caller's transaction when supplied so the membership writes
  // commit atomically with their other writes; otherwise open our own.
  return tx ? run(tx) : db.transaction(run);
}
