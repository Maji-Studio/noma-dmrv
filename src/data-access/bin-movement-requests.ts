/**
 * Idempotent bin-movement requests (issue #773)
 *
 * The bin-movement ledger is append-only, so a double submit would otherwise
 * post the same withdrawal twice. Every lane that writes it funnels through
 * this seam: the caller serializes on the client-supplied request key, replays
 * the stored movement when the same key arrives again, and refuses a key that
 * is reused with different values. The stored key is unique per organization
 * (`bin_movements_org_idempotency_unique`), so one lock namespace covers the
 * output lanes and the feedstock loss lane alike.
 */

import type { DbTransaction } from '@/db';
import { binMovements, storageLocations } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { conflictCode } from '@/lib/conflict-ref';
import { ActionConflictError, SafeError } from '@/lib/errors';
import { and, eq, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { requireOrgScope } from './utils';

const IDEMPOTENCY_LOCK_SEED = 0;
/**
 * One namespace for every lane, because the stored key is org-unique. Keep the
 * historical 'output-request' string: renaming it would send same-key retries
 * on either side of a rolling deploy to different advisory locks, so they race
 * into a unique violation instead of replaying the stored movement.
 */
const REQUEST_LOCK_NAMESPACE = 'output-request';

/** Stable digest of a request payload, used to detect a reused key. */
export function requestFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v)).digest('hex');
}

/** Serializes a request even if a reused key names a different bin. */
export async function lockMovementRequest(ctx: OrgContext, tx: DbTransaction, key: string) {
  requireOrgScope(ctx);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${REQUEST_LOCK_NAMESPACE}:${ctx.organizationId}:${key}`}, ${IDEMPOTENCY_LOCK_SEED}))`);
}

interface MovementRequestLookup {
  idempotencyKey: string;
  /** The values this key stands for. A changed payload is a conflict. */
  payload: unknown;
  /** Conflict target, so a form can point the operator back at the bin. */
  storageLocationId: string;
  conflictMessage: string;
}

/**
 * The movement already stored for this key, or undefined on a first submit.
 * Callers hold the request lock, so a concurrent twin waits here and replays.
 */
export async function findMovementRequest(ctx: OrgContext, tx: DbTransaction, lookup: MovementRequestLookup) {
  requireOrgScope(ctx);
  const [existing] = await tx.select().from(binMovements)
    .where(and(eq(binMovements.organizationId, ctx.organizationId), eq(binMovements.idempotencyKey, lookup.idempotencyKey)));
  if (existing && existing.inputSnapshot?.payloadHash !== requestFingerprint(lookup.payload)) {
    const [bin] = await tx.select({ code: storageLocations.code }).from(storageLocations)
      .where(and(eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.id, lookup.storageLocationId)));
    if (!bin) throw new SafeError('Storage location not found');
    throw new ActionConflictError(lookup.conflictMessage, { entity: 'storageLocation', id: lookup.storageLocationId, code: conflictCode(bin.code) });
  }
  return existing;
}
