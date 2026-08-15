/**
 * Submission ledger — claim choreography.
 *
 * One module owns the sequence *read latest → tentative decide → mapping
 * lock → re-resolve payload → authoritative re-decide → insert/reset draft*
 * so every pipeline (Removal, GHG Statement, eventually telemetry) inherits
 * the same defensiveness against concurrent duplicate submits, mid-flight
 * facility repoints, and source-set drift.
 *
 * The pure claim policy stays in `@/lib/isometric/utils/submission-claim`
 * (`decideSubmissionClaim`); this module is the I/O choreography around it.
 * It is an internal data-access seam tested DB-backed against real Postgres
 * (ADR 0008) — no port, no in-memory fake. It ends at a claimed draft row;
 * no network I/O happens inside. It also owns the guarded interrupted-attempt
 * writer because that outcome must use the same exact draft-lock identity.
 *
 * Plan: docs/archive/plans/2026-06-10-certification-reliability-track.md (Phase 1).
 */
import { and, desc, eq, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { isPgUniqueViolation } from "@/db/errors";
import {
  certificationSubmissions,
  certifierGhgStatements,
  certifierProjects,
  certifierRemovals,
} from "@/db/schema/certification";
import { facilities } from "@/db/schema/facilities";
import { SafeError } from "@/lib/errors";
import { acquireCertificationArtifactLocksSorted } from "@/lib/certification/submission-lock";
import {
  canReclaimInterruptedSubmission,
  SUBMISSION_EXTERNAL_MUTATIONS,
  SUBMISSION_ATTEMPT_OUTCOMES,
  SUBMISSION_METADATA_KEYS,
} from "@/lib/certification/submission-metadata";
import { LOCK_TTL_MS } from "@/lib/isometric/utils/lock";
import { logger } from "@/lib/log";
import { acquireMirrorLocksSorted } from "@/lib/isometric/utils/source-lock";
import type { OrgContext } from "@/lib/auth/server";
import {
  decideSubmissionClaim,
  type SubmissionClaimPolicy,
} from "@/lib/isometric/utils/submission-claim";
import {
  assertSubmissionInFacility,
  type CertificationSubmissionRow,
} from "./certification";
import { acquireFacilityDurabilityLock } from "./facility-durability-lock";
import { assertSameOrg, requireOrgScope } from "./utils";

type CertifierProvider = (typeof certifierProjects.$inferSelect)["provider"];

export interface SubmissionKey {
  provider: CertifierProvider;
  submissionType: string;
  localEntityType: string;
  localEntityId: string;
}

export interface MappingClaimGuard {
  facilityId: string;
  provider: CertifierProvider;
  expectedExternalProjectId: string;
  expectedExternalFacilityId?: string | null;
  expectedDefaultRemovalTemplateId?: string | null;
  expectedDurabilityOption?: (typeof facilities.$inferSelect)["durabilityOption"];
}

export interface InsertDraftSubmissionInput extends SubmissionKey {
  version: number;
  payloadSnapshot: unknown;
  payloadHash: string;
  metadata?: Record<string, unknown> | null;
}

/**
 * Compare-and-set: records the interruption only while the row is still a
 * draft holding this attempt's exact lock. Returns false when the CAS missed
 * (e.g. the lock expired and another claimant re-locked the row) — the caller
 * must surface that loudly, because a confirmed external write would
 * otherwise be silently forgotten.
 */
export async function markSubmissionInterrupted(
  ctx: OrgContext,
  id: string,
  args: {
    errorMessage: string;
    expectedLockedAt: Date;
    externalMutation: "possible" | "confirmed";
  },
): Promise<boolean> {
  requireOrgScope(ctx);
  const updated = await db
    .update(certificationSubmissions)
    .set({
      updatedAt: sql`now()`,
      metadata: sql`coalesce(${certificationSubmissions.metadata}, '{}'::jsonb) || jsonb_build_object(
        ${SUBMISSION_METADATA_KEYS.lastError}::text, ${args.errorMessage}::text,
        ${SUBMISSION_METADATA_KEYS.lastAttemptOutcome}::text, ${SUBMISSION_ATTEMPT_OUTCOMES.interrupted}::text,
        ${SUBMISSION_METADATA_KEYS.externalMutation}::text, ${args.externalMutation}::text
      )`,
    })
    .where(
      and(
        eq(certificationSubmissions.id, id),
        eq(certificationSubmissions.status, "draft"),
        eq(certificationSubmissions.lockedAt, args.expectedLockedAt),
        eq(certificationSubmissions.organizationId, ctx.organizationId),
      ),
    )
    .returning({ id: certificationSubmissions.id });
  return updated.length > 0;
}

/**
 * Journal a confirmed registry identity while retaining the exact draft lock.
 * Follow-up reconciliation can then fail safely: an immediate retry resumes
 * this row by external id instead of POSTing another statement.
 */
export async function recordConfirmedSubmissionIdentity(
  ctx: OrgContext,
  id: string,
  args: { externalId: string; expectedLockedAt: Date },
): Promise<boolean> {
  requireOrgScope(ctx);
  const updated = await db
    .update(certificationSubmissions)
    .set({ externalId: args.externalId, updatedAt: sql`now()` })
    .where(
      and(
        eq(certificationSubmissions.id, id),
        eq(certificationSubmissions.status, "draft"),
        eq(certificationSubmissions.lockedAt, args.expectedLockedAt),
        eq(certificationSubmissions.organizationId, ctx.organizationId),
      ),
    )
    .returning({ id: certificationSubmissions.id });
  return updated.length > 0;
}

// =====================================================================
// claimSubmissionDraft — the single entry point
// =====================================================================

export type NewVersionReason =
  | "first"
  | "submitted-hash-changed"
  | "rejected-hash-changed"
  | "after-superseded";

export type ClaimBlockedReason =
  | "in-flight"
  | "rejected-with-external"
  | "invalid-changed-hash"
  | "state-changed";

export type ClaimOutcome =
  | {
      kind: "claimed";
      row: CertificationSubmissionRow;
      // true ⇒ a prior draft was CAS-reset; its STORED payloadSnapshot is
      // authoritative — `resolve`/`buildSnapshot` were NOT called.
      resumed: boolean;
      // Forward to markSubmissionSubmitted so the prior version is marked
      // superseded in the same transition that stamps the new externalId.
      supersedePreviousId: string | null;
      // Logging only — e.g. the removal pipeline warns on
      // "rejected-hash-changed" (a retry minting a new version).
      reason: NewVersionReason | "resumed";
    }
  | { kind: "existing"; externalId: string; version: number }
  | { kind: "blocked"; reason: ClaimBlockedReason };

export interface ClaimSubmissionDraftArgs<H> {
  key: SubmissionKey;
  guard: MappingClaimGuard;
  policy: SubmissionClaimPolicy;
  // Precomputed before any lock; drives the tentative decision (fast path
  // for blocked / existing / resume — no lock taken, no payload work).
  tentativeInputs: H;
  // The module computes BOTH the tentative and the final hash itself, so a
  // caller cannot smuggle a stale hash past the in-lock re-decision.
  hashOf: (inputs: H) => string;
  // v1's only extra locks: per-document source mirror locks. Acquired
  // sorted, AFTER the mapping lock, so every submit path shares one lock
  // order with mirroring, owning-document deletion, and admin-repoint flows
  // (no ABBA deadlock).
  mirrorDocumentIds?: string[];
  // In-lock re-resolution of hash-covered inputs (e.g. mirrored source IDs).
  // Return `tentative` unchanged when nothing shifted.
  resolve?: (tx: DbTransaction, tentative: H) => Promise<H>;
  // SYNCHRONOUS and tx-free — structurally no I/O can run between the
  // authoritative decision and the insert. `nextVersion` exists only here:
  // version-embedded supplier refs cannot be built pre-decision.
  buildSnapshot: (args: {
    inputs: H;
    nextVersion: number;
    supersedePreviousId: string | null;
    reason: NewVersionReason;
  }) => {
    payloadSnapshot: unknown;
    metadata?: Record<string, unknown> | null;
  };
}

/**
 * Claims a draft ledger row for a submission attempt.
 *
 * Outcomes are claim decisions — callers translate `blocked.reason` into
 * their own domain wording. Mapping-guard violations (facility unlinked or
 * repointed mid-claim) throw `SafeError` with module-owned wording instead:
 * they are configuration races, not claim decisions.
 *
 * An insert is unreachable without the in-lock re-decision: a concurrent
 * duplicate attempt resolves to `existing` or `blocked: "in-flight"`, never
 * a raw unique-constraint error.
 */
export async function claimSubmissionDraft<H>(
  ctx: OrgContext,
  args: ClaimSubmissionDraftArgs<H>,
  tx?: DbTransaction,
): Promise<ClaimOutcome> {
  requireOrgScope(ctx);
  const executor = tx ?? db;
  await assertSubmissionAnchorSameOrg(ctx, args.key, executor);

  const tentativeHash = args.hashOf(args.tentativeInputs);
  const latest = await getLatestSubmissionWithExecutor(ctx, executor, args.key);
  const tentative = decideSubmissionClaim({
    latest,
    payloadHash: tentativeHash,
    now: Date.now(),
    lockTtlMs: LOCK_TTL_MS,
    policy: args.policy,
  });

  switch (tentative.kind) {
    case "blocked-in-flight":
      return { kind: "blocked", reason: "in-flight" };
    case "blocked-rejected-with-external":
      return { kind: "blocked", reason: "rejected-with-external" };
    case "invalid-changed-hash":
      return { kind: "blocked", reason: "invalid-changed-hash" };
    case "return-existing":
      return {
        kind: "existing",
        externalId: tentative.externalId,
        version: tentative.version,
      };
    case "resume":
      return resumeDraft(ctx, args, tentativeHash, tx);
    case "resume-poll-existing":
    case "resume-re-put":
      // Only reachable when `dataUploadResume` is passed to the pure core,
      // which this module never does (telemetry is deferred — see plan).
      throw new Error(`Unreachable claim kind: ${tentative.kind}`);
    case "create-new-version":
      return createDraft(ctx, args, tx);
  }
}

// Resume goes through the CAS reset under the same mapping guard and never
// calls `resolve`/`buildSnapshot` — the stored payloadSnapshot is the truth.
// A lost CAS means a concurrent claimant already re-locked the row.
//
// The pre-lock decision that routed us here is advisory: between that read and
// acquiring the mapping lock a concurrent caller may have finished, superseded,
// or re-locked the row. So we re-read latest and re-decide UNDER the lock —
// mirroring createDraft's authoritative re-decide — and only CAS when the row
// is still genuinely resumable. Without it the broad CAS predicate
// (`status != draft`) could revert a freshly `submitted`/`accepted` row.
async function resumeDraft<H>(
  ctx: OrgContext,
  args: ClaimSubmissionDraftArgs<H>,
  tentativeHash: string,
  callerTx?: DbTransaction,
): Promise<ClaimOutcome> {
  const run = async (tx: DbTransaction): Promise<ClaimOutcome> => {
    await lockAndVerifyMapping(ctx, tx, args.guard);
    await lockSubmissionArtifact(tx, args.key);

    const latest = await getLatestSubmissionWithExecutor(ctx, tx, args.key);
    const decided = decideSubmissionClaim({
      latest,
      payloadHash: tentativeHash,
      now: Date.now(),
      lockTtlMs: LOCK_TTL_MS,
      policy: args.policy,
    });

    switch (decided.kind) {
      case "blocked-in-flight":
        return { kind: "blocked", reason: "in-flight" };
      case "blocked-rejected-with-external":
        return { kind: "blocked", reason: "rejected-with-external" };
      case "invalid-changed-hash":
        return { kind: "blocked", reason: "invalid-changed-hash" };
      case "return-existing":
        return {
          kind: "existing",
          externalId: decided.externalId,
          version: decided.version,
        };
      case "create-new-version":
        // The row advanced out of a resumable state (superseded, or a
        // submitted/accepted row whose hash changed). Don't mint a new version
        // under the resume path — let the caller reload and retry, which
        // re-enters createDraft cleanly.
        return { kind: "blocked", reason: "state-changed" };
      case "resume-poll-existing":
      case "resume-re-put":
        // Only reachable with `dataUploadResume`, which this module never
        // passes (telemetry is deferred — see plan).
        throw new Error(`Unreachable claim kind: ${decided.kind}`);
      case "resume":
        break;
    }

    const row = await resetSubmissionToDraftCas(
      tx,
      ctx,
      decided.resumeRowId,
      LOCK_TTL_MS,
      canReclaimInterruptedSubmission(latest?.metadata),
    );
    if (!row) return { kind: "blocked", reason: "in-flight" };
    return {
      kind: "claimed",
      row,
      resumed: true,
      supersedePreviousId: null,
      reason: "resumed",
    };
  };
  return callerTx ? run(callerTx) : db.transaction(run);
}

async function createDraft<H>(
  ctx: OrgContext,
  args: ClaimSubmissionDraftArgs<H>,
  callerTx?: DbTransaction,
): Promise<ClaimOutcome> {
  try {
    const run = async (tx: DbTransaction): Promise<ClaimOutcome> => {
      await lockAndVerifyMapping(ctx, tx, args.guard);
      await lockSubmissionArtifact(tx, args.key);
      if (args.mirrorDocumentIds && args.mirrorDocumentIds.length > 0) {
        await acquireMirrorLocksSorted(tx, args.mirrorDocumentIds);
      }

      const inputs = args.resolve
        ? await args.resolve(tx, args.tentativeInputs)
        : args.tentativeInputs;
      const finalHash = args.hashOf(inputs);

      // Authoritative re-decide: concurrent winners are committed and
      // visible by the time the mapping lock is acquired (READ COMMITTED),
      // so a duplicate attempt resolves here instead of dying on the
      // unique constraint below.
      const lockedLatest = await getLatestSubmissionWithExecutor(ctx, tx, args.key);
      const locked = decideSubmissionClaim({
        latest: lockedLatest,
        payloadHash: finalHash,
        now: Date.now(),
        lockTtlMs: LOCK_TTL_MS,
        policy: args.policy,
      });

      switch (locked.kind) {
        case "blocked-in-flight":
          return { kind: "blocked", reason: "in-flight" };
        case "blocked-rejected-with-external":
          return { kind: "blocked", reason: "rejected-with-external" };
        case "invalid-changed-hash":
          return { kind: "blocked", reason: "invalid-changed-hash" };
        case "return-existing":
          // Nothing inserted — the transaction ends with no writes, so no
          // orphan draft can exist for this attempt.
          return {
            kind: "existing",
            externalId: locked.externalId,
            version: locked.version,
          };
        case "resume":
          // We prepared a create but the in-lock state says resume. No
          // self-healing: resuming here would depend on payload-shape
          // assumptions this module cannot verify. Callers say "reload
          // and retry".
          return { kind: "blocked", reason: "state-changed" };
        case "resume-poll-existing":
        case "resume-re-put":
          throw new Error(`Unreachable claim kind: ${locked.kind}`);
        case "create-new-version":
          break;
      }

      const { reason } = locked;
      if (
        reason === "dataupload-orphan-restart" ||
        reason === "dataupload-rejected-restart"
      ) {
        // Only reachable with `dataUploadResume`, which is never passed.
        throw new Error(`Unreachable create reason: ${reason}`);
      }

      const snapshot = args.buildSnapshot({
        inputs,
        nextVersion: locked.nextVersion,
        supersedePreviousId: locked.supersedePreviousId,
        reason,
      });
      const row = await insertDraftSubmissionRow(ctx, tx, {
        ...args.key,
        version: locked.nextVersion,
        payloadSnapshot: snapshot.payloadSnapshot,
        payloadHash: finalHash,
        metadata: snapshot.metadata ?? null,
      });
      return {
        kind: "claimed",
        row,
        resumed: false,
        supersedePreviousId: locked.supersedePreviousId,
        reason,
      };
    };
    return await (callerTx ? run(callerTx) : db.transaction(run));
  } catch (err) {
    if (isEntityVersionUniqueViolation(err)) {
      // Backstop: the in-lock re-decision makes this race practically
      // unreachable (creates serialize on the mapping lock), so log it —
      // hitting it means an insert path bypassed the choreography.
      logger.warn(
        {
          localEntityType: args.key.localEntityType,
          localEntityId: args.key.localEntityId,
          submissionType: args.key.submissionType,
        },
        "submission version race hit the unique-constraint backstop",
      );
      return { kind: "blocked", reason: "in-flight" };
    }
    throw err;
  }
}

// =====================================================================
// Ledger reads
// =====================================================================

export async function getLatestSubmission(
  ctx: OrgContext,
  key: SubmissionKey,
  // Defence-in-depth facility scope (issue #277). When set, the resolved row's
  // anchor entity must live in this facility, else SafeError — the caller is
  // acting within one facility and must not receive another's ledger row.
  expectedFacilityId?: string,
): Promise<CertificationSubmissionRow | null> {
  return getLatestSubmissionWithExecutor(ctx, db, key, expectedFacilityId);
}

export async function getLatestSubmissionWithExecutor(
  ctx: OrgContext,
  executor: DbTransaction | typeof db,
  key: SubmissionKey,
  expectedFacilityId?: string,
): Promise<CertificationSubmissionRow | null> {
  requireOrgScope(ctx);
  const row = await readLatestSubmission(ctx, executor, key);
  if (row && expectedFacilityId !== undefined) {
    await assertSubmissionInFacility(ctx, executor, row, expectedFacilityId);
  }
  return row;
}

async function readLatestSubmission(
  ctx: OrgContext,
  executor: DbTransaction | typeof db,
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
        eq(certificationSubmissions.organizationId, ctx.organizationId),
      ),
    )
    .orderBy(desc(certificationSubmissions.version))
    .limit(1);
  return row ?? null;
}

// =====================================================================
// Mapping guard
// =====================================================================

// Locks the facility's certifier mapping row FOR UPDATE and verifies it
// still matches what the caller read before deciding to submit. Guard arms
// are checked by presence: a GHG Statement has no template, so it simply
// omits `expectedDefaultRemovalTemplateId`.
//
// The facility durability lock is always acquired first, followed by the
// mapping lock, so every submit path shares one order
// (`facility → mapping → artifact → mirror`). This serializes the first
// blocking ledger write with facility tier edits and prevents ABBA deadlocks.
async function lockAndVerifyMapping(
  ctx: OrgContext,
  executor: DbTransaction,
  guard: MappingClaimGuard,
): Promise<void> {
  await acquireFacilityDurabilityLock(ctx, executor, guard.facilityId);

  if (guard.expectedDurabilityOption !== undefined) {
    const [facility] = await executor
      .select({ durabilityOption: facilities.durabilityOption })
      .from(facilities)
      .where(
        and(
          eq(facilities.id, guard.facilityId),
          eq(facilities.organizationId, ctx.organizationId),
        ),
      )
      .limit(1);
    if (!facility) {
      throw new SafeError("Facility no longer exists. Reload and retry.");
    }
    if (facility.durabilityOption !== guard.expectedDurabilityOption) {
      throw new SafeError(
        "Facility's durability tier changed mid-submission. Reload and retry.",
      );
    }
  }

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
        eq(certifierProjects.organizationId, ctx.organizationId),
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
      "The facility's default Removal template changed during submission. Refresh and try again.",
    );
  }
}

async function lockSubmissionArtifact(
  tx: DbTransaction,
  key: Pick<SubmissionKey, "provider" | "localEntityType" | "localEntityId">,
): Promise<void> {
  await acquireCertificationArtifactLocksSorted(tx, [
    {
      provider: key.provider,
      localEntityType: key.localEntityType,
      localEntityId: key.localEntityId,
    },
  ]);
}

async function assertSubmissionAnchorSameOrg(
  ctx: OrgContext,
  key: Pick<SubmissionKey, "localEntityType" | "localEntityId">,
  executor: DbTransaction | typeof db = db,
): Promise<void> {
  if (key.localEntityType === "removal") {
    await assertSameOrg(ctx, certifierRemovals, key.localEntityId, executor);
  } else if (key.localEntityType === "ghgStatement") {
    await assertSameOrg(
      ctx,
      certifierGhgStatements,
      key.localEntityId,
      executor,
    );
  }
}

// =====================================================================
// Draft insert / reset primitives
// =====================================================================

// Single source of truth for the draft-insert row shape.
async function insertDraftSubmissionRow(
  ctx: OrgContext,
  tx: DbTransaction,
  input: InsertDraftSubmissionInput,
): Promise<CertificationSubmissionRow> {
  const [row] = await tx
    .insert(certificationSubmissions)
    .values({
      organizationId: ctx.organizationId,
      provider: input.provider,
      submissionType: input.submissionType,
      localEntityType: input.localEntityType,
      localEntityId: input.localEntityId,
      version: input.version,
      status: "draft",
      payloadSnapshot: input.payloadSnapshot as Record<string, unknown>,
      payloadHash: input.payloadHash,
      lockedAt: sql`date_trunc('milliseconds', clock_timestamp())`,
      metadata: (input.metadata ?? null) as Record<string, unknown> | null,
    })
    .returning();
  return row;
}

// Compare-and-swap reset: stale/non-draft rows are normally resumable. A fresh
// draft is resumable only when the caller observed the terminal interrupted
// marker and this UPDATE can atomically require and clear that same marker.
// A concurrent claimant therefore makes the predicate fail, so two callers
// cannot both resume the same submission and double-POST to the registry.
async function resetSubmissionToDraftCas(
  tx: DbTransaction,
  ctx: OrgContext,
  id: string,
  lockTtlMs: number,
  requireConfirmedInterruptedMarker = false,
): Promise<CertificationSubmissionRow | null> {
  const [row] = await tx
    .update(certificationSubmissions)
    .set({
      status: "draft",
      lockedAt: sql`date_trunc('milliseconds', clock_timestamp())`,
      updatedAt: sql`now()`,
      metadata: sql`coalesce(${certificationSubmissions.metadata}, '{}'::jsonb)
        - ${SUBMISSION_METADATA_KEYS.lastError}::text
        - ${SUBMISSION_METADATA_KEYS.lastAttemptOutcome}::text`,
    })
    .where(
      and(
        eq(certificationSubmissions.id, id),
        eq(certificationSubmissions.organizationId, ctx.organizationId),
        requireConfirmedInterruptedMarker
          ? and(
              eq(certificationSubmissions.status, "draft"),
              sql`${certificationSubmissions.metadata} ->> ${SUBMISSION_METADATA_KEYS.lastAttemptOutcome}::text = ${SUBMISSION_ATTEMPT_OUTCOMES.interrupted}`,
              sql`${certificationSubmissions.metadata} ->> ${SUBMISSION_METADATA_KEYS.externalMutation}::text = ${SUBMISSION_EXTERNAL_MUTATIONS.confirmed}`,
            )
          : or(
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
  return row ?? null;
}

// The (provider, submissionType, localEntityType, localEntityId, version)
// unique constraint — a 23505 on THIS index means a concurrent submit already
// claimed the same version. The table carries a second unique index
// (`cert_submissions_external_unique`); a violation there is a different bug
// and must not be relabeled as "already in progress".
const SUBMISSION_ENTITY_VERSION_CONSTRAINT =
  "cert_submissions_entity_version_unique";

function isEntityVersionUniqueViolation(err: unknown): boolean {
  return isPgUniqueViolation(err, SUBMISSION_ENTITY_VERSION_CONSTRAINT);
}

// Maps the entity-version 23505 into a SafeError for the telemetry-boundary
// primitives below, which predate the outcome-shaped contract. Any other
// error propagates unchanged so genuinely different failures aren't masked.
async function withUniqueViolationGuard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isEntityVersionUniqueViolation(err)) {
      throw new SafeError("Submission already in progress");
    }
    throw err;
  }
}

// =====================================================================
// Telemetry boundary — relocated primitives, NOT part of the module's
// public contract. submit-telemetry.ts keeps the journaled-step recovery
// choreography from ADR 0006 until it adopts claimSubmissionDraft (the
// plan's deferred `stepResume` extension). Not re-exported from any barrel.
// =====================================================================

// TODO(telemetry-migration): module-private once submit-telemetry adopts
// claimSubmissionDraft — do not add importers.
export async function insertDraftSubmissionWithMappingLock(
  ctx: OrgContext,
  input: InsertDraftSubmissionInput,
  guard: MappingClaimGuard,
): Promise<CertificationSubmissionRow> {
  requireOrgScope(ctx);
  await assertSubmissionAnchorSameOrg(ctx, input);
  return db.transaction(async (tx) => {
    await lockAndVerifyMapping(ctx, tx, guard);
    await lockSubmissionArtifact(tx, input);
    return withUniqueViolationGuard(() => insertDraftSubmissionRow(ctx, tx, input));
  });
}

// TODO(telemetry-migration): module-private once submit-telemetry adopts
// claimSubmissionDraft — do not add importers.
export async function resetSubmissionToDraftWithMappingLock(
  ctx: OrgContext,
  id: string,
  guard: MappingClaimGuard,
  lockTtlMs: number,
): Promise<CertificationSubmissionRow> {
  requireOrgScope(ctx);
  return db.transaction(async (tx) => {
    await lockAndVerifyMapping(ctx, tx, guard);
    const [rowToReset] = await tx
      .select({
        provider: certificationSubmissions.provider,
        localEntityType: certificationSubmissions.localEntityType,
        localEntityId: certificationSubmissions.localEntityId,
        metadata: certificationSubmissions.metadata,
      })
      .from(certificationSubmissions)
      .where(and(eq(certificationSubmissions.id, id), eq(certificationSubmissions.organizationId, ctx.organizationId)))
      .limit(1);
    if (!rowToReset) throw new SafeError("Submission not found");
    await lockSubmissionArtifact(tx, rowToReset);
    const row = await resetSubmissionToDraftCas(
      tx,
      ctx,
      id,
      lockTtlMs,
      canReclaimInterruptedSubmission(rowToReset.metadata),
    );
    if (!row) throw new SafeError("Submission already in progress");
    return row;
  });
}
