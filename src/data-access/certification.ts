import { and, desc, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  certifierGhgStatements,
  certifierProjects,
  certifierRemovals,
  certificationSubmissions,
  certifierSyncEvents,
} from "@/db/schema/certification";
import { documents } from "@/db/schema/documentation";
import { facilities } from "@/db/schema/facilities";
import { BLOCKING_SUBMISSION_STATUSES } from "@/lib/certification/status";
import { SafeError } from "@/lib/errors";
import { requireAuth } from "./utils";

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
  userId: string,
  facilityId: string,
  provider: CertifierProvider = "isometric",
): Promise<CertifierProjectRow | null> {
  requireAuth(userId);
  const [row] = await db
    .select()
    .from(certifierProjects)
    .where(
      and(
        eq(certifierProjects.facilityId, facilityId),
        eq(certifierProjects.provider, provider),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listFacilitiesLinkedToExternal(
  userId: string,
  provider: CertifierProvider,
  externalProjectId: string,
): Promise<LinkedFacilitySummary[]> {
  requireAuth(userId);
  const rows = await db
    .select({
      facilityId: facilities.id,
      code: facilities.code,
      name: facilities.name,
    })
    .from(certifierProjects)
    .innerJoin(facilities, eq(certifierProjects.facilityId, facilities.id))
    .where(
      and(
        eq(certifierProjects.provider, provider),
        eq(certifierProjects.externalProjectId, externalProjectId),
      ),
    );
  return rows;
}

export interface LinkedFacilityByProject extends LinkedFacilitySummary {
  externalProjectId: string;
}

export async function listAllFacilitiesLinkedByProvider(
  userId: string,
  provider: CertifierProvider,
): Promise<LinkedFacilityByProject[]> {
  requireAuth(userId);
  return db
    .select({
      externalProjectId: certifierProjects.externalProjectId,
      facilityId: facilities.id,
      code: facilities.code,
      name: facilities.name,
    })
    .from(certifierProjects)
    .innerJoin(facilities, eq(certifierProjects.facilityId, facilities.id))
    .where(eq(certifierProjects.provider, provider));
}

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Submission types that pin a facility's certifier mapping through a Removal.
// Both the Removal itself (ADR 0003) and its telemetry data-upload (ADR 0006)
// are keyed to `certifierRemovals.id` with `localEntityType='removal'`; a
// repoint/unlink that orphaned the mapping would strand either one's remote
// resource, so both must block.
const REMOVAL_SCOPED_SUBMISSION_TYPES = ["removal", "dataUpload"] as const;

async function hasBlockingFacilitySubmission(
  executor: Tx | typeof db,
  facilityId: string,
  provider: CertifierProvider,
): Promise<boolean> {
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
        eq(certificationSubmissions.localEntityId, certifierRemovals.id),
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
        ),
      )
      .limit(1),
    executor
      .select({ id: certificationSubmissions.id })
      .from(certificationSubmissions)
      .innerJoin(
        certifierGhgStatements,
        eq(certificationSubmissions.localEntityId, certifierGhgStatements.id),
      )
      .where(
        and(
          eq(certificationSubmissions.provider, provider),
          eq(certificationSubmissions.localEntityType, "ghgStatement"),
          eq(certificationSubmissions.submissionType, "ghg_statement"),
          eq(certifierGhgStatements.facilityId, facilityId),
          inArray(certificationSubmissions.status, BLOCKING_SUBMISSION_STATUSES),
        ),
      )
      .limit(1),
  ]);
  return removalHit.length > 0 || ghgHit.length > 0;
}

export async function upsertCertifierProject(
  userId: string,
  input: UpsertCertifierProjectInput,
): Promise<CertifierProjectRow> {
  requireAuth(userId);
  const values = {
    facilityId: input.facilityId,
    provider: input.provider,
    externalProjectId: input.externalProjectId,
    protocolSlug: input.protocolSlug ?? "biochar",
    protocolVersion: input.protocolVersion ?? null,
    defaultRemovalTemplateId: input.defaultRemovalTemplateId ?? null,
    externalFacilityId: input.externalFacilityId ?? null,
    metadata: input.metadata ?? null,
  };

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(certifierProjects)
      .where(
        and(
          eq(certifierProjects.facilityId, input.facilityId),
          eq(certifierProjects.provider, input.provider),
        ),
      )
      .for("update")
      .limit(1);

    // The Isometric facility id (fcl_…) is a 1:1 anchor — two noma facilities
    // sharing one would cross-contaminate telemetry. A DB unique constraint
    // (provider, external_facility_id) is the backstop; this in-transaction
    // probe turns the raw 23505 into a clear, actionable message. Projects may
    // still be shared across facilities — only the fcl_ id is locked.
    if (values.externalFacilityId) {
      const [collision] = await tx
        .select({
          code: facilities.code,
          name: facilities.name,
        })
        .from(certifierProjects)
        .innerJoin(facilities, eq(certifierProjects.facilityId, facilities.id))
        .where(
          and(
            eq(certifierProjects.provider, input.provider),
            eq(certifierProjects.externalFacilityId, values.externalFacilityId),
            ne(certifierProjects.facilityId, input.facilityId),
          ),
        )
        .limit(1);
      if (collision) {
        throw new SafeError(
          `Isometric facility ID ${values.externalFacilityId} is already linked to ${collision.code} — ${collision.name}. Each Isometric facility maps to exactly one facility here.`,
        );
      }
    }

    const mappingIdentifiersChanged =
      existing &&
      (existing.externalProjectId !== values.externalProjectId ||
        existing.externalFacilityId !== values.externalFacilityId);
    if (mappingIdentifiersChanged) {
      const blocked = await hasBlockingFacilitySubmission(
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

    const [row] = await tx
      .insert(certifierProjects)
      .values(values)
      .onConflictDoUpdate({
        target: [certifierProjects.facilityId, certifierProjects.provider],
        set: {
          externalProjectId: values.externalProjectId,
          protocolSlug: values.protocolSlug,
          protocolVersion: values.protocolVersion,
          defaultRemovalTemplateId: values.defaultRemovalTemplateId,
          externalFacilityId: values.externalFacilityId,
          metadata: values.metadata,
          updatedAt: sql`now()`,
        },
      })
      .returning();
    return row;
  });
}

export interface FacilityEmissionConfigInput {
  facilityId: string;
  provider?: CertifierProvider;
  gensetEnergyYieldKwhPerLitre: number;
  stageSplitBiomassPct: number;
  stageSplitPyrolysisPct: number;
  stageSplitBiocharPct: number;
}

// Updates only the four Phase 3.7 emission-estimate columns on an
// existing certifier_projects row. The facility must already be linked
// to an Isometric project — the config has no meaning otherwise.
export async function updateFacilityEmissionConfig(
  userId: string,
  input: FacilityEmissionConfigInput,
): Promise<CertifierProjectRow> {
  requireAuth(userId);
  const provider = input.provider ?? "isometric";
  const [row] = await db
    .update(certifierProjects)
    .set({
      gensetEnergyYieldKwhPerLitre: input.gensetEnergyYieldKwhPerLitre,
      stageSplitBiomassPct: input.stageSplitBiomassPct,
      stageSplitPyrolysisPct: input.stageSplitPyrolysisPct,
      stageSplitBiocharPct: input.stageSplitBiocharPct,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(certifierProjects.facilityId, input.facilityId),
        eq(certifierProjects.provider, provider),
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
  userId: string,
  facilityId: string,
  provider: CertifierProvider = "isometric",
): Promise<void> {
  requireAuth(userId);

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
        ),
      )
      .for("update")
      .limit(1);

    // Unlink guard: refuse if any facility-scoped certifier removal
    // submission depends on this mapping.
    const blocked = await hasBlockingFacilitySubmission(tx, facilityId, provider);
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
        ),
      );
  });
}

// =====================================================================
// Submission ledger
// =====================================================================

export type CertificationSubmissionRow =
  typeof certificationSubmissions.$inferSelect;
export type CertifierSyncEventRow = typeof certifierSyncEvents.$inferSelect;

export interface SubmissionKey {
  provider: CertifierProvider;
  submissionType: string;
  localEntityType: string;
  localEntityId: string;
}

export async function getLatestSubmission(
  userId: string,
  key: SubmissionKey,
): Promise<CertificationSubmissionRow | null> {
  requireAuth(userId);
  return getLatestSubmissionWithExecutor(db, key);
}

export async function getLatestSubmissionInTx(
  userId: string,
  tx: Tx,
  key: SubmissionKey,
): Promise<CertificationSubmissionRow | null> {
  requireAuth(userId);
  return getLatestSubmissionWithExecutor(tx, key);
}

async function getLatestSubmissionWithExecutor(
  executor: Tx | typeof db,
  key: SubmissionKey,
): Promise<CertificationSubmissionRow | null> {
  const [row] = await executor
    .select()
    .from(certificationSubmissions)
    .where(
      and(
        eq(certificationSubmissions.provider, key.provider),
        eq(certificationSubmissions.submissionType, key.submissionType),
        eq(certificationSubmissions.localEntityType, key.localEntityType),
        eq(certificationSubmissions.localEntityId, key.localEntityId),
      ),
    )
    .orderBy(desc(certificationSubmissions.version))
    .limit(1);
  return row ?? null;
}

// Batched sibling of getLatestSubmission — one round-trip for N local
// entities. DISTINCT ON keeps the highest-version row per localEntityId, the
// same "latest" rule as getLatestSubmission. Returns a localEntityId → row
// map; entities with no submission are simply absent.
export async function getLatestSubmissionsForEntities(
  userId: string,
  key: {
    provider: CertifierProvider;
    submissionType: string;
    localEntityType: string;
    localEntityIds: string[];
  },
): Promise<Map<string, CertificationSubmissionRow>> {
  requireAuth(userId);
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
      ),
    )
    .orderBy(
      certificationSubmissions.localEntityId,
      desc(certificationSubmissions.version),
    );
  return new Map(rows.map((row) => [row.localEntityId, row]));
}

export async function getSubmissionById(
  userId: string,
  id: string,
): Promise<CertificationSubmissionRow | null> {
  requireAuth(userId);
  const [row] = await db
    .select()
    .from(certificationSubmissions)
    .where(eq(certificationSubmissions.id, id))
    .limit(1);
  return row ?? null;
}

export interface InsertDraftSubmissionInput extends SubmissionKey {
  version: number;
  payloadSnapshot: unknown;
  payloadHash: string;
  metadata?: Record<string, unknown> | null;
}

export async function insertDraftSubmission(
  userId: string,
  input: InsertDraftSubmissionInput,
): Promise<CertificationSubmissionRow> {
  requireAuth(userId);
  // Unique-violation (23505) on (provider, submissionType, localEntityType,
  // localEntityId, version) means another draft is already in flight for
  // this tuple; the guard surfaces it as a SafeError so the orchestrator's
  // branch-b path is consistent with concurrent inserts losing the race.
  return withUniqueViolationGuard(() =>
    db.transaction(async (tx) => insertDraftSubmissionRow(tx, input)),
  );
}

export interface MappingClaimGuard {
  facilityId: string;
  provider: CertifierProvider;
  expectedExternalProjectId: string;
  expectedExternalFacilityId?: string | null;
  expectedDefaultRemovalTemplateId?: string | null;
}

async function lockAndVerifyMapping(
  executor: Tx,
  guard: MappingClaimGuard,
): Promise<void> {
  const [current] = await executor
    .select({
      externalProjectId: certifierProjects.externalProjectId,
      externalFacilityId: certifierProjects.externalFacilityId,
      defaultRemovalTemplateId: certifierProjects.defaultRemovalTemplateId,
    })
    .from(certifierProjects)
    .where(
      and(
        eq(certifierProjects.facilityId, guard.facilityId),
        eq(certifierProjects.provider, guard.provider),
      ),
    )
    .for("update")
    .limit(1);

  if (!current) {
    throw new SafeError(
      "Facility is no longer linked to a certifier project. Re-link in facility settings before submitting.",
    );
  }
  if (current.externalProjectId !== guard.expectedExternalProjectId) {
    throw new SafeError(
      "Facility was repointed to a different certifier project mid-submission. Refresh and retry.",
    );
  }
  if (
    guard.expectedExternalFacilityId !== undefined &&
    current.externalFacilityId !== guard.expectedExternalFacilityId
  ) {
    throw new SafeError(
      "Facility was repointed to a different certifier facility mid-submission. Refresh and retry.",
    );
  }
  if (
    guard.expectedDefaultRemovalTemplateId !== undefined &&
    current.defaultRemovalTemplateId !== guard.expectedDefaultRemovalTemplateId
  ) {
    throw new SafeError(
      "Facility's default removal template changed mid-submission. Refresh and retry.",
    );
  }
}

// Single source of truth for the draft-insert row shape. Every public
// submit-path inserts through here, so a future column change touches one
// site, not three.
async function insertDraftSubmissionRow(
  tx: Tx,
  input: InsertDraftSubmissionInput,
): Promise<CertificationSubmissionRow> {
  const [row] = await tx
    .insert(certificationSubmissions)
    .values({
      provider: input.provider,
      submissionType: input.submissionType,
      localEntityType: input.localEntityType,
      localEntityId: input.localEntityId,
      version: input.version,
      status: "draft",
      payloadSnapshot: input.payloadSnapshot as Record<string, unknown>,
      payloadHash: input.payloadHash,
      lockedAt: sql`now()`,
      metadata: (input.metadata ?? null) as Record<string, unknown> | null,
    })
    .returning();
  return row;
}

// The (provider, submissionType, localEntityType, localEntityId, version)
// unique constraint — a 23505 on THIS index means a concurrent submit already
// claimed the same version. The table carries a second unique index
// (`cert_submissions_external_unique`); a violation there is a different bug
// and must not be relabeled as "already in progress".
const SUBMISSION_ENTITY_VERSION_CONSTRAINT =
  "cert_submissions_entity_version_unique";

// Maps the Postgres unique-violation (23505) on the entity-version constraint
// into a SafeError. Centralized so every public submit entry point reports the
// same user-facing message. Any other 23505 (or non-23505 error) propagates
// unchanged so genuinely different failures aren't masked.
async function withUniqueViolationGuard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "23505" &&
      (err as { constraint?: string }).constraint ===
        SUBMISSION_ENTITY_VERSION_CONSTRAINT
    ) {
      throw new SafeError("Submission already in progress");
    }
    throw err;
  }
}

// Composable variant: caller provides a `prepare` callback that runs inside
// the transaction after the mapping lock is held, so it can acquire
// additional advisory locks and recompute hash-covered fields (Phase 3.5:
// per-document mirror locks bracketing source-id resolution). The callback
// returns the finalized InsertDraftSubmissionInput which is then inserted in
// the same transaction.
//
// The mapping lock is always acquired FIRST so every submit path shares one
// lock order (`mapping → caller-supplied locks`), preventing an ABBA
// deadlock with admin flows that touch certifier_projects and
// certifier_document_uploads in the opposite order.
export async function insertDraftSubmissionWithMappingLockAndLocks(
  userId: string,
  guard: MappingClaimGuard,
  prepare: (tx: Tx) => Promise<InsertDraftSubmissionInput>,
): Promise<CertificationSubmissionRow> {
  requireAuth(userId);
  return db.transaction(async (tx) => {
    await lockAndVerifyMapping(tx, guard);
    const input = await prepare(tx);
    return withUniqueViolationGuard(() => insertDraftSubmissionRow(tx, input));
  });
}

export async function insertDraftSubmissionWithMappingLock(
  userId: string,
  input: InsertDraftSubmissionInput,
  guard: MappingClaimGuard,
): Promise<CertificationSubmissionRow> {
  return insertDraftSubmissionWithMappingLockAndLocks(
    userId,
    guard,
    async () => input,
  );
}

export async function markSubmissionSubmitted(
  userId: string,
  id: string,
  args: { externalId: string; supersedePreviousId?: string | null },
): Promise<void> {
  requireAuth(userId);
  await db.transaction(async (tx) => {
    await tx
      .update(certificationSubmissions)
      .set({
        status: "submitted",
        externalId: args.externalId,
        submittedAt: sql`now()`,
        lockedAt: null,
        updatedAt: sql`now()`,
      })
      .where(eq(certificationSubmissions.id, id));
    if (args.supersedePreviousId) {
      await tx
        .update(certificationSubmissions)
        .set({
          status: "superseded",
          supersededAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(certificationSubmissions.id, args.supersedePreviousId));
    }
  });
}

export async function markSubmissionRejected(
  userId: string,
  id: string,
  args: { errorMessage: string },
): Promise<void> {
  requireAuth(userId);
  await db
    .update(certificationSubmissions)
    .set({
      status: "rejected",
      lockedAt: null,
      updatedAt: sql`now()`,
      metadata: sql`coalesce(${certificationSubmissions.metadata}, '{}'::jsonb) || jsonb_build_object('lastError', ${args.errorMessage}::text)`,
    })
    .where(eq(certificationSubmissions.id, id));
}

export async function resetSubmissionToDraft(
  userId: string,
  id: string,
): Promise<CertificationSubmissionRow> {
  requireAuth(userId);
  const [row] = await db
    .update(certificationSubmissions)
    .set({
      status: "draft",
      lockedAt: sql`now()`,
      updatedAt: sql`now()`,
      metadata: sql`coalesce(${certificationSubmissions.metadata}, '{}'::jsonb) - 'lastError'`,
    })
    .where(eq(certificationSubmissions.id, id))
    .returning();
  if (!row) throw new SafeError("Submission not found");
  return row;
}

export async function resetSubmissionToDraftWithMappingLock(
  userId: string,
  id: string,
  guard: MappingClaimGuard,
  lockTtlMs: number,
): Promise<CertificationSubmissionRow> {
  requireAuth(userId);
  return db.transaction(async (tx) => {
    await lockAndVerifyMapping(tx, guard);
    // Compare-and-swap: only a row that is NOT a freshly-locked draft is
    // resumable. If a concurrent caller already claimed it (flipping it to a
    // fresh draft), this UPDATE matches zero rows — so two callers cannot
    // both resume the same submission and double-POST to the registry.
    const [row] = await tx
      .update(certificationSubmissions)
      .set({
        status: "draft",
        lockedAt: sql`now()`,
        updatedAt: sql`now()`,
        metadata: sql`coalesce(${certificationSubmissions.metadata}, '{}'::jsonb) - 'lastError'`,
      })
      .where(
        and(
          eq(certificationSubmissions.id, id),
          or(
            ne(certificationSubmissions.status, "draft"),
            isNull(certificationSubmissions.lockedAt),
            lt(
              certificationSubmissions.lockedAt,
              sql`now() - ${lockTtlMs} * interval '1 millisecond'`,
            ),
          ),
        ),
      )
      .returning();
    if (!row) throw new SafeError("Submission already in progress");
    return row;
  });
}

// Accumulates per-step recovery IDs into `payload_snapshot.journaled`
// (ADR 0006 §3). The data-upload resume reader (`readResumeSnapshot`) consults
// `payloadSnapshot.journaled`, so the journal MUST live there, not in
// `metadata`. Each step deep-merges into the journaled sub-object — a plain
// top-level `payload_snapshot || {journaled: patch}` would replace the whole
// journaled object and drop earlier steps' IDs (e.g. step 2 erasing step 1's
// fileUploadId/uploadUrl), defeating recovery.
export async function appendSubmissionJournal(
  userId: string,
  id: string,
  patch: Record<string, unknown>,
  tx?: Tx,
): Promise<void> {
  requireAuth(userId);
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
    .where(eq(certificationSubmissions.id, id));
}

export async function updateSubmissionMetadata(
  userId: string,
  id: string,
  patch: Record<string, unknown>,
  tx?: Tx,
): Promise<void> {
  requireAuth(userId);
  await (tx ?? db)
    .update(certificationSubmissions)
    .set({
      metadata: sql`coalesce(${certificationSubmissions.metadata}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
      updatedAt: sql`now()`,
    })
    .where(eq(certificationSubmissions.id, id));
}

export async function setSubmissionTerminalStatus(
  userId: string,
  id: string,
  args: {
    status: "accepted" | "rejected";
    metadataPatch?: Record<string, unknown>;
  },
  tx?: Tx,
): Promise<void> {
  requireAuth(userId);
  await (tx ?? db)
    .update(certificationSubmissions)
    .set({
      status: args.status,
      lockedAt: null,
      metadata: sql`coalesce(${certificationSubmissions.metadata}, '{}'::jsonb) || ${JSON.stringify(args.metadataPatch ?? {})}::jsonb`,
      updatedAt: sql`now()`,
    })
    .where(eq(certificationSubmissions.id, id));
}

export async function clearTerminalStatusForResubmit(
  userId: string,
  id: string,
  args: { metadataPatch?: Record<string, unknown> } = {},
  tx?: Tx,
): Promise<void> {
  requireAuth(userId);
  await (tx ?? db)
    .update(certificationSubmissions)
    .set({
      status: "submitted",
      lockedAt: null,
      metadata: sql`coalesce(${certificationSubmissions.metadata}, '{}'::jsonb) || ${JSON.stringify(args.metadataPatch ?? {})}::jsonb`,
      updatedAt: sql`now()`,
    })
    .where(eq(certificationSubmissions.id, id));
}

export async function getSubmissionWithLatestSyncEvent(
  userId: string,
  id: string,
): Promise<{
  submission: CertificationSubmissionRow;
  latestSyncEvent: CertifierSyncEventRow | null;
} | null> {
  requireAuth(userId);
  const submission = await getSubmissionById(userId, id);
  if (!submission) return null;
  const [latestSyncEvent] = await db
    .select()
    .from(certifierSyncEvents)
    .where(
      and(
        eq(certifierSyncEvents.entityType, submission.localEntityType),
        eq(certifierSyncEvents.entityId, submission.localEntityId),
      ),
    )
    .orderBy(desc(certifierSyncEvents.attemptedAt))
    .limit(1);
  return { submission, latestSyncEvent: latestSyncEvent ?? null };
}

export async function attachReportDocument(
  userId: string,
  args: {
    submissionId: string;
    reportUrl: string;
    description: string;
    metadata?: Record<string, unknown>;
  },
): Promise<DocumentRow> {
  requireAuth(userId);
  const [row] = await db
    .insert(documents)
    .values({
      entityType: "ghgStatement",
      entityId: args.submissionId,
      documentType: "pdf",
      fileUrl: args.reportUrl,
      fileName: deriveFileName(args.reportUrl),
      description: args.description,
      metadata: (args.metadata ?? {}) as Record<string, unknown>,
      createdBy: userId,
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
}

export async function appendSyncEvent(
  userId: string,
  input: AppendSyncEventInput,
): Promise<void> {
  requireAuth(userId);
  await db.insert(certifierSyncEvents).values({
    provider: input.provider,
    entityType: input.entityType,
    entityId: input.entityId,
    operation: input.operation,
    status: input.status,
    requestPayload: (input.requestPayload ?? null) as Record<string, unknown>,
    responsePayload: (input.responsePayload ?? null) as Record<string, unknown>,
    errorMessage: input.errorMessage ?? null,
  });
}

export async function listRecentSyncEvents(
  userId: string,
  args: { entityType: string; entityId: string; limit: number },
): Promise<CertifierSyncEventRow[]> {
  requireAuth(userId);
  return db
    .select()
    .from(certifierSyncEvents)
    .where(
      and(
        eq(certifierSyncEvents.entityType, args.entityType),
        eq(certifierSyncEvents.entityId, args.entityId),
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
