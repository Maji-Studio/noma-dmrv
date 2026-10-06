/**
 * Idempotency records for API writes (data-entry API plan, section 4).
 *
 * The claim runs inside the write's own transaction, at Read Committed:
 *
 * 1. `SET LOCAL lock_timeout` to a short claim budget, then
 *    `INSERT ... ON CONFLICT DO NOTHING`. While another transaction holds an
 *    uncommitted record with the same key, PostgreSQL makes this INSERT wait
 *    on it and cannot see it.
 * 2. The wait times out: the transaction is aborted, so the caller rolls back
 *    and answers "still running" (409 + Retry-After). Never continue in it.
 * 3. The first request committed: the INSERT inserts nothing and the next
 *    statement's snapshot sees the committed record. Same fingerprint replays,
 *    a different one is refused.
 * 4. The first request rolled back: this INSERT inserts, and this request owns
 *    the key.
 *
 * Only committed successes leave a record; a failed write rolls its claim back
 * with everything else, so a retry is evaluated afresh.
 */

import { and, eq, sql } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { pgErrorCode, PG_LOCK_NOT_AVAILABLE } from "@/db/errors";
import { apiIdempotencyRecords } from "@/db/schema";
import {
  IDEMPOTENCY_CLAIM_LOCK_TIMEOUT_MS,
  IDEMPOTENCY_OUTCOME_SCHEMA_VERSION,
  IDEMPOTENCY_RETENTION_DAYS,
  IDEMPOTENCY_RETRY_AFTER_SECONDS,
} from "@/config/operations";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/operations/errors";
import { requireOrgScope, type Executor } from "./utils";

const DAY_MS = 86_400_000;

export interface IdempotencyClaim {
  credentialId: string;
  key: string;
  operationId: string;
  fingerprint: string;
}

export type ClaimResult =
  | { kind: "owner"; recordId: string }
  | { kind: "replay"; outcome: unknown };

interface CommittedRecord {
  id: string;
  fingerprint: string;
  outcome: unknown;
  outcomeSchemaVersion: number;
  expiresAt: Date;
}

function stillRunning(cause?: unknown): DomainError {
  return new DomainError(
    "idempotency_in_progress",
    "A request with this idempotency key is still running. Retry shortly.",
    { retryable: true, retryAfterSeconds: IDEMPOTENCY_RETRY_AFTER_SECONDS, cause },
  );
}

async function findRecord(
  ctx: OrgContext,
  executor: Executor,
  credentialId: string,
  key: string,
): Promise<CommittedRecord | undefined> {
  const [record] = await executor
    .select({
      id: apiIdempotencyRecords.id,
      fingerprint: apiIdempotencyRecords.fingerprint,
      outcome: apiIdempotencyRecords.outcome,
      outcomeSchemaVersion: apiIdempotencyRecords.outcomeSchemaVersion,
      expiresAt: apiIdempotencyRecords.expiresAt,
    })
    .from(apiIdempotencyRecords)
    .where(
      and(
        eq(apiIdempotencyRecords.organizationId, ctx.organizationId),
        eq(apiIdempotencyRecords.credentialId, credentialId),
        eq(apiIdempotencyRecords.idempotencyKey, key),
      ),
    );
  return record;
}

/**
 * Run one claim statement under the short claim budget. A wait on another
 * transaction's row becomes "still running"; afterwards the connection's
 * lock budget is restored, so a later domain-lock timeout is never reported
 * as "still running". The reset is skipped by PostgreSQL when the statement
 * aborted the transaction, which the caller rolls back anyway.
 */
async function withClaimLockTimeout<T>(tx: DbTransaction, statement: () => Promise<T>): Promise<T> {
  await tx.execute(
    sql.raw(`set local lock_timeout = ${IDEMPOTENCY_CLAIM_LOCK_TIMEOUT_MS}`),
  );
  try {
    return await statement();
  } catch (error) {
    if (pgErrorCode(error) === PG_LOCK_NOT_AVAILABLE) throw stillRunning(error);
    throw error;
  } finally {
    await tx.execute(sql`reset lock_timeout`).catch(() => undefined);
  }
}

async function insertClaim(
  ctx: OrgContext,
  tx: DbTransaction,
  claim: IdempotencyClaim,
  now: Date,
): Promise<string | undefined> {
  return withClaimLockTimeout(tx, async () => {
    const [inserted] = await tx
      .insert(apiIdempotencyRecords)
      .values({
        organizationId: ctx.organizationId,
        credentialId: claim.credentialId,
        idempotencyKey: claim.key,
        operationId: claim.operationId,
        fingerprint: claim.fingerprint,
        outcomeSchemaVersion: IDEMPOTENCY_OUTCOME_SCHEMA_VERSION,
        expiresAt: new Date(now.getTime() + IDEMPOTENCY_RETENTION_DAYS * DAY_MS),
      })
      .onConflictDoNothing({
        target: [
          apiIdempotencyRecords.organizationId,
          apiIdempotencyRecords.credentialId,
          apiIdempotencyRecords.idempotencyKey,
        ],
      })
      .returning({ id: apiIdempotencyRecords.id });
    return inserted?.id;
  });
}

/**
 * Claim `claim.key` for this write, or return the committed outcome to
 * replay. Throws `idempotency_in_progress` while another transaction holds
 * the key (the transaction is then aborted) and `idempotency_key_reused` when
 * the key was committed for a different request.
 */
export async function claimIdempotencyKey(
  ctx: OrgContext,
  tx: DbTransaction,
  claim: IdempotencyClaim,
  now: Date = new Date(),
): Promise<ClaimResult> {
  requireOrgScope(ctx);
  const insertedId = await insertClaim(ctx, tx, claim, now);
  if (insertedId) return { kind: "owner", recordId: insertedId };

  const record = await findRecord(ctx, tx, claim.credentialId, claim.key);
  if (!record) {
    // The holder rolled back between our INSERT and SELECT; claim again.
    const retriedId = await insertClaim(ctx, tx, claim, now);
    if (retriedId) return { kind: "owner", recordId: retriedId };
    throw stillRunning();
  }

  if (record.expiresAt.getTime() <= now.getTime()) {
    // Past retention the key may be reused as a new request. Another request
    // reclaiming the same expired key holds this row until it commits.
    await withClaimLockTimeout(tx, () =>
      tx
        .delete(apiIdempotencyRecords)
        .where(
          and(
            eq(apiIdempotencyRecords.id, record.id),
            eq(apiIdempotencyRecords.organizationId, ctx.organizationId),
          ),
        ),
    );
    const reclaimedId = await insertClaim(ctx, tx, claim, now);
    if (reclaimedId) return { kind: "owner", recordId: reclaimedId };
    throw stillRunning();
  }

  if (record.fingerprint !== claim.fingerprint) {
    throw new DomainError(
      "idempotency_key_reused",
      "This idempotency key was already used for a different request. Use a new key.",
    );
  }
  if (record.outcome == null || record.outcomeSchemaVersion !== IDEMPOTENCY_OUTCOME_SCHEMA_VERSION) {
    throw new DomainError(
      "replay_unavailable",
      "The stored result for this idempotency key can no longer be replayed. Use a new key.",
    );
  }
  return { kind: "replay", outcome: record.outcome };
}

/**
 * Dry runs never claim, consume or replay a key, but a key that already has a
 * committed record is refused rather than previewed as if it were new.
 */
export async function assertIdempotencyKeyUnused(
  ctx: OrgContext,
  executor: Executor,
  credentialId: string,
  key: string,
  now: Date = new Date(),
): Promise<void> {
  requireOrgScope(ctx);
  const record = await findRecord(ctx, executor, credentialId, key);
  if (record && record.expiresAt.getTime() > now.getTime()) {
    throw new DomainError(
      "key_already_used",
      "This idempotency key already belongs to a committed request. A dry run needs a new key or none.",
    );
  }
}

/** Store the transport-neutral outcome on the claimed record, before commit. */
export async function recordIdempotencyOutcome(
  ctx: OrgContext,
  tx: DbTransaction,
  recordId: string,
  outcome: unknown,
): Promise<void> {
  requireOrgScope(ctx);
  await tx
    .update(apiIdempotencyRecords)
    .set({ outcome })
    .where(
      and(
        eq(apiIdempotencyRecords.id, recordId),
        eq(apiIdempotencyRecords.organizationId, ctx.organizationId),
      ),
    );
}
