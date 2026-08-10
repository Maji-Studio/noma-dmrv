import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { isPgUniqueViolation } from "@/db/errors";
import {
  certifierGhgStatements,
  certifierProjects,
  certifierRemovals,
  certificationSubmissions,
  certifierSyncEvents,
} from "@/db/schema/certification";
import { creditBatches } from "@/db/schema/credits";
import { documents } from "@/db/schema/documentation";
import { facilities } from "@/db/schema/facilities";
import { BLOCKING_SUBMISSION_STATUSES } from "@/lib/certification/status";
import { SUBMISSION_METADATA_KEYS } from "@/lib/isometric/utils/submission-metadata";
import { DEFAULT_PROTOCOL_SLUG } from "@/config/certification";
import {
  GHG_STATEMENT_ENTITY_TYPE,
  REMOVAL_ENTITY_TYPE,
} from "@/lib/isometric/utils/constants";
import { SafeError } from "@/lib/errors";
import { pluralize } from "@/lib/copy-utils";
import type { OrgContext } from "@/lib/auth/server";
import { assertSameOrg, requireOrgScope } from "./utils";

type CertifierProvider = (typeof certifierProjects.$inferSelect)["provider"];
export type CertifierProjectRow = typeof certifierProjects.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;

export interface UpsertCertifierProjectInput {
  facilityId: string;
  provider: CertifierProvider;
  externalProjectId: string;
  protocolSlug?: string;
  protocolVersion?: string | null;
  defaultRemovalTemplateId?: string | null;
  // Phase 5 Slice A — operator-pasted Isometric facility id (fcl_…).
  // Optional; required only for telemetry submission.
  externalFacilityId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface LinkedFacilitySummary {
  facilityId: string;
  code: string;
  name: string;
}

export async function getCertifierProjectByFacility(
  ctx: OrgContext,
  facilityId: string,
  provider: CertifierProvider = "isometric",
): Promise<CertifierProjectRow | null> {
  requireOrgScope(ctx);
  const [row] = await db
    .select()
    .from(certifierProjects)
    .where(
      and(
        eq(certifierProjects.facilityId, facilityId),
        eq(certifierProjects.provider, provider),
        eq(certifierProjects.organizationId, ctx.organizationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listFacilitiesLinkedToExternal(
  ctx: OrgContext,
  provider: CertifierProvider,
  externalProjectId: string,
): Promise<LinkedFacilitySummary[]> {
  requireOrgScope(ctx);
  const rows = await db
    .select({
      facilityId: facilities.id,
      code: facilities.code,
      name: facilities.name,
    })
    .from(certifierProjects)
    .innerJoin(facilities, and(eq(certifierProjects.facilityId, facilities.id), eq(facilities.organizationId, ctx.organizationId)))
    .where(
      and(
        eq(certifierProjects.provider, provider),
        eq(certifierProjects.externalProjectId, externalProjectId),
        eq(certifierProjects.organizationId, ctx.organizationId),
      ),
    );
  return rows;
}

export interface LinkedFacilityByProject extends LinkedFacilitySummary {
  externalProjectId: string;
}

export async function listAllFacilitiesLinkedByProvider(
  ctx: OrgContext,
  provider: CertifierProvider,
): Promise<LinkedFacilityByProject[]> {
  requireOrgScope(ctx);
  return db
    .select({
      externalProjectId: certifierProjects.externalProjectId,
      facilityId: facilities.id,
      code: facilities.code,
      name: facilities.name,
    })
    .from(certifierProjects)
    .innerJoin(facilities, and(eq(certifierProjects.facilityId, facilities.id), eq(facilities.organizationId, ctx.organizationId)))
    .where(and(eq(certifierProjects.provider, provider), eq(certifierProjects.organizationId, ctx.organizationId)));
}

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Submission types that pin a facility's certifier mapping through a Removal.
// Both the Removal itself (ADR 0003) and its telemetry data-upload (ADR 0006)
// are keyed to `certifierRemovals.id` with `localEntityType='removal'`; a
// repoint/unlink that orphaned the mapping would strand either one's remote
// resource, so both must block.
const REMOVAL_SCOPED_SUBMISSION_TYPES = ["removal", "dataUpload"] as const;

// Exported for the facility archive-with-warning gate (archive stays allowed;
// the dialog surfaces a warning when registry submissions exist).
export async function hasBlockingFacilitySubmission(
  ctx: OrgContext,
  executor: Tx | typeof db,
  facilityId: string,
  provider: CertifierProvider,
): Promise<boolean> {
  requireOrgScope(ctx);
  // Two facility-scoped artifacts can pin a mapping: a Removal (ADR 0003,
  // which also covers its telemetry data-upload per ADR 0006 — both join
  // through certifierRemovals) and a GHG Statement (ADR 0004). Each carries
  // facilityId directly — one hop, no lineage walk. Two small probes are
  // clearer than a UNION/OR and let the planner use each artifact's own index.
  const [removalHit, ghgHit] = await Promise.all([
    executor
      .select({ id: certificationSubmissions.id })
      .from(certificationSubmissions)
      .innerJoin(
        certifierRemovals,
        and(eq(certificationSubmissions.localEntityId, certifierRemovals.id), eq(certifierRemovals.organizationId, ctx.organizationId)),
      )
      .where(
        and(
          eq(certificationSubmissions.provider, provider),
          eq(certificationSubmissions.localEntityType, "removal"),
          inArray(
            certificationSubmissions.submissionType,
            REMOVAL_SCOPED_SUBMISSION_TYPES,
          ),
          eq(certifierRemovals.facilityId, facilityId),
          inArray(certificationSubmissions.status, BLOCKING_SUBMISSION_STATUSES),
          eq(certificationSubmissions.organizationId, ctx.organizationId),
        ),
      )
      .limit(1),
    executor
      .select({ id: certificationSubmissions.id })
      .from(certificationSubmissions)
      .innerJoin(
        certifierGhgStatements,
        and(eq(certificationSubmissions.localEntityId, certifierGhgStatements.id), eq(certifierGhgStatements.organizationId, ctx.organizationId)),
      )
      .where(
        and(
          eq(certificationSubmissions.provider, provider),
          eq(certificationSubmissions.localEntityType, "ghgStatement"),
          eq(certificationSubmissions.submissionType, "ghg_statement"),
          eq(certifierGhgStatements.facilityId, facilityId),
          inArray(certificationSubmissions.status, BLOCKING_SUBMISSION_STATUSES),
          eq(certificationSubmissions.organizationId, ctx.organizationId),
        ),
      )
      .limit(1),
  ]);
  return removalHit.length > 0 || ghgHit.length > 0;
}

// DB-level backstop for the (provider, external_facility_id) 1:1 anchor. The
// serial in-transaction probe in upsertCertifierProject cannot see a concurrent
// upsert (each only row-locks its own facility), so the unique index fires for
// the loser. Relabel that one 23505 as a clear SafeError; every other error
// (including the entity-version 23505 handled elsewhere) propagates unchanged.
const CERTIFIER_EXTERNAL_FACILITY_CONSTRAINT =
  "certifier_projects_provider_external_facility_unique";

async function withExternalFacilityConflictGuard<T>(
  externalFacilityId: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isPgUniqueViolation(err, CERTIFIER_EXTERNAL_FACILITY_CONSTRAINT)) {
      throw new SafeError(
        `Isometric facility ID ${externalFacilityId} is already linked to another facility. Each Isometric facility maps to exactly one facility here.`,
      );
    }
    throw err;
  }
}

export async function upsertCertifierProject(
  ctx: OrgContext,
  input: UpsertCertifierProjectInput,
): Promise<CertifierProjectRow> {
  requireOrgScope(ctx);
  const values = {
    organizationId: ctx.organizationId,
    facilityId: input.facilityId,
    provider: input.provider,
    externalProjectId: input.externalProjectId,
    protocolSlug: input.protocolSlug ?? DEFAULT_PROTOCOL_SLUG,
    protocolVersion: input.protocolVersion ?? null,
    defaultRemovalTemplateId: input.defaultRemovalTemplateId ?? null,
    externalFacilityId: input.externalFacilityId ?? null,
    metadata: input.metadata ?? null,
  };

  const runUpsert = () =>
    db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(certifierProjects)
        .where(
          and(
            eq(certifierProjects.facilityId, input.facilityId),
            eq(certifierProjects.provider, input.provider),
            eq(certifierProjects.organizationId, ctx.organizationId),
          ),
        )
        .for("update")
        .limit(1);

      // The Isometric facility id (fcl_…) is a 1:1 anchor — two noma facilities
      // sharing one would cross-contaminate telemetry. A DB unique constraint
      // (provider, external_facility_id) is the backstop; this in-transaction
      // probe turns the raw 23505 into a clear, actionable message naming the
      // colliding facility. Projects may still be shared across facilities —
      // only the fcl_ id is locked. Two concurrent upserts can each pass this
      // probe (each row-locks only its own facility), so the DB constraint
      // still fires for one — withExternalFacilityConflictGuard catches it.
      if (values.externalFacilityId) {
        const [collision] = await tx
          .select({
            code: facilities.code,
            name: facilities.name,
          })
          .from(certifierProjects)
          .innerJoin(facilities, and(eq(certifierProjects.facilityId, facilities.id), eq(facilities.organizationId, ctx.organizationId)))
          .where(
            and(
              eq(certifierProjects.provider, input.provider),
              eq(
                certifierProjects.externalFacilityId,
                values.externalFacilityId,
              ),
              ne(certifierProjects.facilityId, input.facilityId),
              eq(certifierProjects.organizationId, ctx.organizationId),
            ),
          )
          .limit(1);
        if (collision) {
          throw new SafeError(
            `Isometric facility ID ${values.externalFacilityId} is already linked to ${collision.code}: ${collision.name}. Each Isometric facility maps to one noma facility.`,
          );
        }
      }

      // Adopting a facility id for the first time (null -> fcl_...) stays
      // allowed even while submissions exist: none of them referenced any
      // facility id, so there is no registry lineage to contradict, and
      // production-batch registration (issue #630) cannot start until the id
      // is set. Only rebinding away from an established identifier (project
      // change, or a non-null facility id changing or clearing) requires
      // superseding the submissions first.
      const mappingIdentifiersChanged =
        existing &&
        (existing.externalProjectId !== values.externalProjectId ||
          (existing.externalFacilityId !== null &&
            existing.externalFacilityId !== values.externalFacilityId));
      if (mappingIdentifiersChanged) {
        const blocked = await hasBlockingFacilitySubmission(
          ctx,
          tx,
          input.facilityId,
          input.provider,
        );
        if (blocked) {
          throw new SafeError(
            "Cannot change certifier project or facility ID: this facility has certifier submissions. Supersede or reject them first.",
          );
        }
      }

      // org-scope-ok: values includes the active organization id.
      const [row] = await tx
        .insert(certifierProjects)
        .values(values)
        .onConflictDoUpdate({
          target: [certifierProjects.facilityId, certifierProjects.provider],
          set: {
            externalProjectId: values.externalProjectId,
            protocolSlug: values.protocolSlug,
            // The supported settings form does not expose protocol version.
            // Preserve an audited value only while saving the same project.
            // A rebind clears the old project's value until the new project is
            // audited; explicit null also remains available to clear it.
            protocolVersion:
              input.protocolVersion === undefined
                ? sql<string | null>`case
                    when ${certifierProjects.externalProjectId} = ${values.externalProjectId}
                    then ${certifierProjects.protocolVersion}
                    else null
                  end`
                : values.protocolVersion,
            defaultRemovalTemplateId: values.defaultRemovalTemplateId,
            externalFacilityId: values.externalFacilityId,
            metadata: values.metadata,
            updatedAt: sql`now()`,
          },
        })
        .returning();
      return row;
    });

  return withExternalFacilityConflictGuard(values.externalFacilityId, runUpsert);
}

export interface FacilityEmissionConfigInput {
  facilityId: string;
  provider?: CertifierProvider;
  // Vestigial local estimate since issue #319 (diesel submits by volume) —
  // optional so a facility with no genset can save the soil-temp fields.
  gensetEnergyYieldKwhPerLitre?: number | null;
  defaultSoilTemperatureC?: number | null;
  defaultSoilTemperatureSource?: string | null;
}

// Updates only the emission-config columns on an existing
// certifier_projects row: the genset energy yield plus the reference
// soil-temperature value + its dataset citation. ADR 0015 dropped the three
// stage-split columns. The facility must already be linked to an Isometric
// project — the config has no meaning otherwise.
export async function updateFacilityEmissionConfig(
  ctx: OrgContext,
  input: FacilityEmissionConfigInput,
): Promise<CertifierProjectRow> {
  requireOrgScope(ctx);
  const provider = input.provider ?? "isometric";
  const [row] = await db
    .update(certifierProjects)
    .set({
      gensetEnergyYieldKwhPerLitre: input.gensetEnergyYieldKwhPerLitre ?? null,
      defaultSoilTemperatureC: input.defaultSoilTemperatureC ?? null,
      defaultSoilTemperatureSource: input.defaultSoilTemperatureSource ?? null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(certifierProjects.facilityId, input.facilityId),
        eq(certifierProjects.provider, provider),
        eq(certifierProjects.organizationId, ctx.organizationId),
      ),
    )
    .returning();
  if (!row) {
    throw new SafeError(
      `Link this facility to a ${provider} project before setting emission estimates.`,
    );
  }
  return row;
}

export async function deleteCertifierProject(
  ctx: OrgContext,
  facilityId: string,
  provider: CertifierProvider = "isometric",
): Promise<void> {
  requireOrgScope(ctx);

  await db.transaction(async (tx) => {
    // Lock the mapping row so a concurrent submission insert that depends on
    // this mapping cannot race the unlink check.
    await tx
      .select({ id: certifierProjects.id })
      .from(certifierProjects)
      .where(
        and(
          eq(certifierProjects.facilityId, facilityId),
          eq(certifierProjects.provider, provider),
          eq(certifierProjects.organizationId, ctx.organizationId),
        ),
      )
      .for("update")
      .limit(1);

    // Unlink guard: refuse if any facility-scoped certifier removal
    // submission depends on this mapping.
    const blocked = await hasBlockingFacilitySubmission(ctx, tx, facilityId, provider);
    if (blocked) {
      throw new SafeError(
        "Cannot unlink: this facility has certifier submissions. Supersede or reject them first.",
      );
    }

    await tx
      .delete(certifierProjects)
      .where(
        and(
          eq(certifierProjects.facilityId, facilityId),
          eq(certifierProjects.provider, provider),
          eq(certifierProjects.organizationId, ctx.organizationId),
        ),
      );
  });
}

// =====================================================================
// Submission ledger
// =====================================================================
//
// The claim choreography (latest read → decide → mapping lock → re-decide →
// insert/reset draft) lives in `./certification-submissions` —
// `claimSubmissionDraft` is the single entry point. This file keeps the
// post-claim transitions (submitted / rejected / terminal), the batched and
// by-id reads, and the sync-event journal.

export type CertificationSubmissionRow =
  typeof certificationSubmissions.$inferSelect;
export type CertifierSyncEventRow = typeof certifierSyncEvents.$inferSelect;

// =====================================================================
// Resolved-facility scope (defence in depth — issue #277)
// =====================================================================
//
// Every certification submission is anchored to a Removal or a GHG Statement,
// both of which carry `facilityId` directly. These helpers resolve the facility
// that OWNS a submission from that anchor row — never a client-supplied field —
// so id/key-addressed reads can be refused when they cross a facility boundary,
// mirroring reconcileRemovalMembership's step-0 facility resolve.
//
// This is NOT per-user membership, and it is NOT (yet) cross-facility
// authorization. There is no membership model (issue #372 / ADR 0010) and no
// independent active-facility context on the server actions, so today every
// wired caller derives `expectedFacilityId` from the *same* anchor id it is
// operating on. That makes the comparison lineage-consistency, whose only
// live rejection is a dangling/unresolvable anchor (fail-closed) — a genuine
// cross-facility id swap can only be rejected once an *independent* facility
// (a real membership check or a session-level active facility) is threaded in.
// These helpers are that seam: they resolve a submission's owning facility
// from its anchor row (never a client-supplied field), so the id/key-addressed
// reads can be refused the moment #372 lands an independent value to compare
// against. See docs/open-questions.md `security/certification-submit-authz`.

// `removal` covers both Removal and telemetry (dataUpload) submissions (ADR
// 0006 — both key `localEntityId` to certifierRemovals.id); `ghgStatement`
// resolves through certifierGhgStatements. Both anchor tables carry facilityId.
//
// Batched facility lookup for a set of local-entity ids of one type. Returns an
// id → facilityId map; ids whose anchor row no longer exists are simply absent.
async function facilityIdsForLocalEntities(
  ctx: OrgContext,
  executor: Tx | typeof db,
  localEntityType: string,
  ids: string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  if (localEntityType === REMOVAL_ENTITY_TYPE) {
    const rows = await executor
      .select({ id: certifierRemovals.id, facilityId: certifierRemovals.facilityId })
      .from(certifierRemovals)
      .where(and(inArray(certifierRemovals.id, ids), eq(certifierRemovals.organizationId, ctx.organizationId)));
    return new Map(rows.map((r) => [r.id, r.facilityId]));
  }
  if (localEntityType === GHG_STATEMENT_ENTITY_TYPE) {
    const rows = await executor
      .select({
        id: certifierGhgStatements.id,
        facilityId: certifierGhgStatements.facilityId,
      })
      .from(certifierGhgStatements)
      .where(and(inArray(certifierGhgStatements.id, ids), eq(certifierGhgStatements.organizationId, ctx.organizationId)));
    return new Map(rows.map((r) => [r.id, r.facilityId]));
  }
  return new Map();
}

// Resolves the facility that owns a submission row via its anchor entity.
// Returns null for an unknown local-entity type or a dangling anchor.
export async function resolveSubmissionFacilityId(
  ctx: OrgContext,
  executor: Tx | typeof db,
  row: Pick<CertificationSubmissionRow, "localEntityType" | "localEntityId">,
): Promise<string | null> {
  requireOrgScope(ctx);
  const byId = await facilityIdsForLocalEntities(ctx, executor, row.localEntityType, [
    row.localEntityId,
  ]);
  return byId.get(row.localEntityId) ?? null;
}

// Throws SafeError unless the submission's resolved facility matches the one the
// caller is operating within. Fail-closed: an unresolvable anchor is refused
// rather than allowed (a submission whose facility can't be proven must not be
// acted on across a boundary).
export async function assertSubmissionInFacility(
  ctx: OrgContext,
  executor: Tx | typeof db,
  row: Pick<CertificationSubmissionRow, "localEntityType" | "localEntityId">,
  expectedFacilityId: string,
): Promise<void> {
  requireOrgScope(ctx);
  const facilityId = await resolveSubmissionFacilityId(ctx, executor, row);
  if (facilityId !== expectedFacilityId) {
    throw new SafeError("Submission does not belong to this facility.");
  }
}

// Batched sibling of getLatestSubmission — one round-trip for N local
// entities. DISTINCT ON keeps the highest-version row per localEntityId, the
// same "latest" rule as getLatestSubmission. Returns a localEntityId → row
// map; entities with no submission are simply absent.
export async function getLatestSubmissionsForEntities(
  ctx: OrgContext,
  key: {
    provider: CertifierProvider;
    submissionType: string;
    localEntityType: string;
    localEntityIds: string[];
  },
  // Defence-in-depth facility scope (issue #277). When set, rows whose anchor
  // entity lives in a different facility are dropped from the result — a
  // batched read must not leak another facility's ledger rows.
  expectedFacilityId?: string,
): Promise<Map<string, CertificationSubmissionRow>> {
  requireOrgScope(ctx);
  if (key.localEntityIds.length === 0) return new Map();
  const rows = await db
    .selectDistinctOn([certificationSubmissions.localEntityId])
    .from(certificationSubmissions)
    .where(
      and(
        eq(certificationSubmissions.provider, key.provider),
        eq(certificationSubmissions.submissionType, key.submissionType),
        eq(certificationSubmissions.localEntityType, key.localEntityType),
        inArray(certificationSubmissions.localEntityId, key.localEntityIds),
        eq(certificationSubmissions.organizationId, ctx.organizationId),
      ),
    )
    .orderBy(
      certificationSubmissions.localEntityId,
      desc(certificationSubmissions.version),
    );
  if (expectedFacilityId === undefined) {
    return new Map(rows.map((row) => [row.localEntityId, row]));
  }
  const facilityById = await facilityIdsForLocalEntities(
    ctx,
    db,
    key.localEntityType,
    rows.map((row) => row.localEntityId),
  );
  return new Map(
    rows
      .filter(
        (row) => facilityById.get(row.localEntityId) === expectedFacilityId,
      )
      .map((row) => [row.localEntityId, row]),
  );
}

export async function getSubmissionById(
  ctx: OrgContext,
  id: string,
  // Defence-in-depth facility scope (issue #277). When set, a submission whose
  // anchor entity resolves to a different facility is refused (SafeError)
  // instead of returned by raw id.
  expectedFacilityId?: string,
): Promise<CertificationSubmissionRow | null> {
  requireOrgScope(ctx);
  const [row] = await db
    .select()
    .from(certificationSubmissions)
    .where(and(eq(certificationSubmissions.id, id), eq(certificationSubmissions.organizationId, ctx.organizationId)))
    .limit(1);
  if (!row) return null;
  if (expectedFacilityId !== undefined) {
    await assertSubmissionInFacility(ctx, db, row, expectedFacilityId);
  }
  return row;
}

export async function getSubmissionByExternalId(
  ctx: OrgContext,
  args: {
    provider: CertificationSubmissionRow["provider"];
    submissionType: string;
    externalId: string;
  },
): Promise<CertificationSubmissionRow | null> {
  requireOrgScope(ctx);
  const [row] = await db
    .select()
    .from(certificationSubmissions)
    .where(
      and(
        eq(certificationSubmissions.provider, args.provider),
        eq(certificationSubmissions.submissionType, args.submissionType),
        eq(certificationSubmissions.externalId, args.externalId),
        eq(
          certificationSubmissions.organizationId,
          ctx.organizationId,
        ),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function markSubmissionSubmitted(
  ctx: OrgContext,
  id: string,
  args: {
    externalId: string;
    supersedePreviousId?: string | null;
    // §8.6.2 (issue #349): stamp the claiming removal onto its member credit
    // batches in the SAME transaction that flips the ledger row to
    // 'submitted'. Guarded (unclaimed-or-self) so a resubmit/supersede by the
    // same removal is idempotent. Optional — telemetry / GHG-statement
    // callers don't claim.
    productionEmissionsClaim?: { removalId: string; creditBatchIds: string[] };
  },
  callerTx?: Tx,
): Promise<void> {
  requireOrgScope(ctx);
  const run = async (tx: Tx): Promise<void> => {
    await tx
      .update(certificationSubmissions)
      .set({
        status: "submitted",
        externalId: args.externalId,
        submittedAt: sql`now()`,
        lockedAt: null,
        metadata: sql`coalesce(${certificationSubmissions.metadata}, '{}'::jsonb) - ${SUBMISSION_METADATA_KEYS.lastError}::text - ${SUBMISSION_METADATA_KEYS.lastAttemptOutcome}::text - ${SUBMISSION_METADATA_KEYS.externalMutation}::text`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(certificationSubmissions.id, id), eq(certificationSubmissions.organizationId, ctx.organizationId)));
    if (args.supersedePreviousId) {
      await tx
        .update(certificationSubmissions)
        .set({
          status: "superseded",
          supersededAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(and(eq(certificationSubmissions.id, args.supersedePreviousId), eq(certificationSubmissions.organizationId, ctx.organizationId)));
    }
    if (
      args.productionEmissionsClaim &&
      args.productionEmissionsClaim.creditBatchIds.length > 0
    ) {
      // A throw here rolls back the ledger flip too: the row stays a locked
      // draft, the resume path reconciles the already-POSTed registry
      // artifacts by supplier ref, and the pre-flight claim gate re-fires
      // loudly on retry.
      await stampProductionEmissionsClaimWithExecutor(
        ctx,
        tx,
        args.productionEmissionsClaim,
      );
    }
  };
  await (callerTx ? run(callerTx) : db.transaction(run));
}

// Standalone claim stamp for the no-POST paths (issue #349, ADR 0020):
// a removal that short-circuits via `return-existing` was submitted before
// the claim column existed (migration 0068) with an unchanged payload hash,
// so it never reaches markSubmissionSubmitted's transactional stamp — this
// lazily backfills the claim. Same guarded UPDATE + rowcount backstop.
export async function stampProductionEmissionsClaim(
  ctx: OrgContext,
  args: { removalId: string; creditBatchIds: string[] },
): Promise<void> {
  requireOrgScope(ctx);
  if (args.creditBatchIds.length === 0) return;
  await stampProductionEmissionsClaimWithExecutor(ctx, db, args);
}

// §8.6.2 claim stamp (issue #349, ADR 0020). Guarded UPDATE (IS NULL OR =
// self): unclaimed rows and self re-claims (resubmit/supersede) are stamped;
// a foreign-claimed row is excluded by the predicate. The rowcount backstop
// turns that exclusion into a loud failure — submit-removal's pre-POST gates
// make it practically unreachable, but the member batches are not locked
// between the draft claim and this write, so a mid-flight foreign claim
// would otherwise leave the ledger submitted with no local error.
async function stampProductionEmissionsClaimWithExecutor(
  ctx: OrgContext,
  executor: Tx | typeof db,
  args: { removalId: string; creditBatchIds: string[] },
): Promise<void> {
  const { removalId, creditBatchIds } = args;
  const stamped = await executor
    .update(creditBatches)
    .set({
      productionEmissionsClaimedByRemovalId: removalId,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        inArray(creditBatches.id, creditBatchIds),
        or(
          isNull(creditBatches.productionEmissionsClaimedByRemovalId),
          eq(creditBatches.productionEmissionsClaimedByRemovalId, removalId),
        ),
        eq(creditBatches.organizationId, ctx.organizationId),
      ),
    )
    .returning({ id: creditBatches.id });
  if (stamped.length !== creditBatchIds.length) {
    const stampedIds = new Set(stamped.map((row) => row.id));
    const skipped = creditBatchIds.filter((id) => !stampedIds.has(id));
    throw new SafeError(
      `${skipped.length} credit ${pluralize(skipped.length, "batch", "batches")} ${skipped.length === 1 ? "was" : "were"} claimed by another Removal while this submission was running (§8.6.2). Reload and submit again.`,
    );
  }
}

// Retires a claimed draft this deploy refuses to resume (currently: its
// snapshot predates the live INPUT_MAPPING revision — see
// production-claim-gate.ts). `superseded` is terminal and NON-blocking, so
// the next submit attempt mints a fresh version from live data; `rejected`
// would route straight back to resume on an unchanged hash and loop forever.
// Status-guarded to drafts — never retires a row that progressed.
export async function retireStaleSubmissionDraft(
  ctx: OrgContext,
  id: string,
  args: { reason: string },
): Promise<void> {
  requireOrgScope(ctx);
  await db
    .update(certificationSubmissions)
    .set({
      status: "superseded",
      supersededAt: sql`now()`,
      lockedAt: null,
      updatedAt: sql`now()`,
      metadata: sql`coalesce(${certificationSubmissions.metadata}, '{}'::jsonb) || jsonb_build_object('retiredReason', ${args.reason}::text)`,
    })
    .where(
      and(
        eq(certificationSubmissions.id, id),
        eq(certificationSubmissions.status, "draft"),
        eq(certificationSubmissions.organizationId, ctx.organizationId),
      ),
    );
}

export async function markSubmissionRejected(
  ctx: OrgContext,
  id: string,
  args: { errorMessage: string; expectedLockedAt?: Date },
): Promise<void> {
  requireOrgScope(ctx);
  await db
    .update(certificationSubmissions)
    .set({
      status: "rejected",
      lockedAt: null,
      updatedAt: sql`now()`,
      metadata: sql`coalesce(${certificationSubmissions.metadata}, '{}'::jsonb) || jsonb_build_object(${SUBMISSION_METADATA_KEYS.lastError}::text, ${args.errorMessage}::text)`,
    })
    .where(
      and(
        eq(certificationSubmissions.id, id),
        eq(certificationSubmissions.status, "draft"),
        args.expectedLockedAt
          ? eq(certificationSubmissions.lockedAt, args.expectedLockedAt)
          : undefined,
        eq(certificationSubmissions.organizationId, ctx.organizationId),
      ),
    );
}

// Accumulates per-step recovery IDs into `payload_snapshot.journaled`
// (ADR 0006 §3). The data-upload resume reader (`readResumeSnapshot`) consults
// `payloadSnapshot.journaled`, so the journal MUST live there, not in
// `metadata`. Each step deep-merges into the journaled sub-object — a plain
// top-level `payload_snapshot || {journaled: patch}` would replace the whole
// journaled object and drop earlier steps' IDs (e.g. step 2 erasing step 1's
// fileUploadId/uploadUrl), defeating recovery.
export async function appendSubmissionJournal(
  ctx: OrgContext,
  id: string,
  patch: Record<string, unknown>,
  tx?: Tx,
): Promise<void> {
  requireOrgScope(ctx);
  await (tx ?? db)
    .update(certificationSubmissions)
    .set({
      payloadSnapshot: sql`jsonb_set(
        coalesce(${certificationSubmissions.payloadSnapshot}, '{}'::jsonb),
        '{journaled}',
        coalesce(${certificationSubmissions.payloadSnapshot} -> 'journaled', '{}'::jsonb)
          || ${JSON.stringify(patch)}::jsonb,
        true
      )`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(certificationSubmissions.id, id), eq(certificationSubmissions.organizationId, ctx.organizationId)));
}

export async function updateSubmissionMetadata(
  ctx: OrgContext,
  id: string,
  patch: Record<string, unknown>,
  tx?: Tx,
): Promise<void> {
  requireOrgScope(ctx);
  await (tx ?? db)
    .update(certificationSubmissions)
    .set({
      metadata: sql`coalesce(${certificationSubmissions.metadata}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(certificationSubmissions.id, id), eq(certificationSubmissions.organizationId, ctx.organizationId)));
}

export async function setSubmissionTerminalStatus(
  ctx: OrgContext,
  id: string,
  args: {
    status: "accepted" | "rejected";
    metadataPatch?: Record<string, unknown>;
  },
  tx?: Tx,
): Promise<void> {
  requireOrgScope(ctx);
  await (tx ?? db)
    .update(certificationSubmissions)
    .set({
      status: args.status,
      lockedAt: null,
      metadata: sql`coalesce(${certificationSubmissions.metadata}, '{}'::jsonb) || ${JSON.stringify(args.metadataPatch ?? {})}::jsonb`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(certificationSubmissions.id, id), eq(certificationSubmissions.organizationId, ctx.organizationId)));
}

export async function clearTerminalStatusForResubmit(
  ctx: OrgContext,
  id: string,
  args: { metadataPatch?: Record<string, unknown> } = {},
  tx?: Tx,
): Promise<void> {
  requireOrgScope(ctx);
  await (tx ?? db)
    .update(certificationSubmissions)
    .set({
      status: "submitted",
      lockedAt: null,
      metadata: sql`coalesce(${certificationSubmissions.metadata}, '{}'::jsonb) || ${JSON.stringify(args.metadataPatch ?? {})}::jsonb`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(certificationSubmissions.id, id), eq(certificationSubmissions.organizationId, ctx.organizationId)));
}

export async function getSubmissionWithLatestSyncEvent(
  ctx: OrgContext,
  id: string,
): Promise<{
  submission: CertificationSubmissionRow;
  latestSyncEvent: CertifierSyncEventRow | null;
} | null> {
  requireOrgScope(ctx);
  const submission = await getSubmissionById(ctx, id);
  if (!submission) return null;
  const [latestSyncEvent] = await db
    .select()
    .from(certifierSyncEvents)
    .where(
      and(
        eq(certifierSyncEvents.entityType, submission.localEntityType),
        eq(certifierSyncEvents.entityId, submission.localEntityId),
        eq(certifierSyncEvents.organizationId, ctx.organizationId),
      ),
    )
    .orderBy(desc(certifierSyncEvents.attemptedAt))
    .limit(1);
  return { submission, latestSyncEvent: latestSyncEvent ?? null };
}

export async function attachReportDocument(
  ctx: OrgContext,
  args: {
    submissionId: string;
    reportUrl: string;
    description: string;
    metadata?: Record<string, unknown>;
  },
): Promise<DocumentRow> {
  requireOrgScope(ctx);
  await assertSameOrg(ctx, certificationSubmissions, args.submissionId);
  const [existing] = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.entityType, "ghgStatement"),
        eq(documents.entityId, args.submissionId),
        eq(documents.fileUrl, args.reportUrl),
        eq(documents.organizationId, ctx.organizationId),
      ),
    )
    .orderBy(desc(documents.createdAt))
    .limit(1);
  if (existing) return existing;
  const [row] = await db
    .insert(documents)
    .values({
      organizationId: ctx.organizationId,
      entityType: "ghgStatement",
      entityId: args.submissionId,
      documentType: "pdf",
      fileUrl: args.reportUrl,
      fileName: deriveFileName(args.reportUrl),
      description: args.description,
      metadata: {
        kind: "external_ghg_statement_report",
        ...(args.metadata ?? {}),
      } as Record<string, unknown>,
      createdBy: ctx.userId,
    })
    .returning();
  return row;
}

export interface AppendSyncEventInput {
  provider: CertifierProvider;
  entityType: string;
  entityId: string;
  operation: string;
  status: "succeeded" | "failed";
  requestPayload?: unknown;
  responsePayload?: unknown;
  errorMessage?: string | null;
  attemptedAt?: Date;
}

export async function appendSyncEvent(
  ctx: OrgContext,
  input: AppendSyncEventInput,
): Promise<void> {
  requireOrgScope(ctx);
  await db.insert(certifierSyncEvents).values({
    organizationId: ctx.organizationId,
    provider: input.provider,
    entityType: input.entityType,
    entityId: input.entityId,
    operation: input.operation,
    status: input.status,
    requestPayload: (input.requestPayload ?? null) as Record<string, unknown>,
    responsePayload: (input.responsePayload ?? null) as Record<string, unknown>,
    errorMessage: input.errorMessage ?? null,
    attemptedAt: input.attemptedAt,
  });
}

export async function listRecentSyncEvents(
  ctx: OrgContext,
  args: { entityType: string; entityId: string; limit: number },
): Promise<CertifierSyncEventRow[]> {
  requireOrgScope(ctx);
  return db
    .select()
    .from(certifierSyncEvents)
    .where(
      and(
        eq(certifierSyncEvents.entityType, args.entityType),
        eq(certifierSyncEvents.entityId, args.entityId),
        eq(certifierSyncEvents.organizationId, ctx.organizationId),
      ),
    )
    .orderBy(desc(certifierSyncEvents.attemptedAt))
    .limit(args.limit);
}

function deriveFileName(reportUrl: string): string {
  if (!URL.canParse(reportUrl)) return "ghg-statement-report.pdf";
  const lastSegment = new URL(reportUrl).pathname
    .split("/")
    .filter(Boolean)
    .at(-1);
  return lastSegment || "ghg-statement-report.pdf";
}
