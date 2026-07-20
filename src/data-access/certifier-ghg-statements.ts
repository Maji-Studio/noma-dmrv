import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { countRows } from "@/db/aggregate";
import {
  certifierGhgStatements,
  certifierRemovals,
  certificationSubmissions,
} from "@/db/schema/certification";
import { SafeError } from "@/lib/errors";
import { decideRemovalMembership } from "@/lib/isometric/utils/ghg-entry-membership";
import type { Tx } from "./certification";
import type { OrgContext } from "@/lib/auth/server";
import { assertSameOrg, requireOrgScope } from "./utils";
import type { CertifierRemovalRow } from "./certifier-removals";

export type CertifierGhgStatementRow =
  typeof certifierGhgStatements.$inferSelect;

const ISOMETRIC = "isometric" as const;

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
    throw new SafeError("GHG statement could not be created. Retry.");
  }
  return { statement: existing, created: false };
}

// Persists the server-derived reporting-period start after the statement is
// created in Isometric (the create API derives it; we cannot set it).
export async function updateGhgStatementReportingWindow(
  ctx: OrgContext,
  id: string,
  args: { reportingPeriodStartOn: string | null },
  tx?: Tx,
): Promise<void> {
  requireOrgScope(ctx);
  await (tx ?? db)
    .update(certifierGhgStatements)
    .set({
      reportingPeriodStartOn: args.reportingPeriodStartOn,
      updatedAt: sql`now()`,
    })
    .where(and(eq(certifierGhgStatements.id, id), eq(certifierGhgStatements.organizationId, ctx.organizationId)));
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
): Promise<ReconcileResult> {
  requireOrgScope(ctx);
  if (externalRemovalIds.length === 0) {
    return { linkedRemovalIds: [], warnings: [] };
  }

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
      throw new SafeError("GHG statement not found for reconciliation.");
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

    // 2. Lock the candidate removal rows and read their current membership +
    //    facility, so the link decision and the write are atomic (no steal,
    //    no race) and we can drop any removal whose facility doesn't match
    //    the target statement.
    const candidateIds = [...new Set(externalToLocal.values())];
    const currentMembership = new Map<string, string | null>();
    if (candidateIds.length > 0) {
      const current = await tx
        .select({
          id: certifierRemovals.id,
          facilityId: certifierRemovals.facilityId,
          ghgStatementId: certifierRemovals.ghgStatementId,
        })
        .from(certifierRemovals)
        .where(and(inArray(certifierRemovals.id, candidateIds), eq(certifierRemovals.organizationId, ctx.organizationId)))
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
    if (decision.toLink.length > 0) {
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

    return {
      linkedRemovalIds: decision.linkedRemovalIds,
      warnings: decision.warnings,
    };
  };

  // Join the caller's transaction when supplied so the membership writes
  // commit atomically with their other writes; otherwise open our own.
  return tx ? run(tx) : db.transaction(run);
}
