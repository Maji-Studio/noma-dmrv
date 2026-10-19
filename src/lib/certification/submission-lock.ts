import { sql } from "drizzle-orm";
import type { DbTransaction } from "@/db";

export interface CertificationArtifactLock {
  provider: string;
  localEntityType: string;
  localEntityId: string;
}

export function certificationArtifactLockKey(
  lock: CertificationArtifactLock,
): string {
  return `certification-artifact:${lock.provider}:${lock.localEntityType}:${lock.localEntityId}`;
}

function sortedUniqueLocks(locks: CertificationArtifactLock[]): CertificationArtifactLock[] {
  return Array.from(
    new Map(locks.map((lock) => [certificationArtifactLockKey(lock), lock]))
      .values(),
  ).sort((a, b) =>
    certificationArtifactLockKey(a).localeCompare(
      certificationArtifactLockKey(b),
    ),
  );
}

export async function acquireCertificationArtifactLocksSorted(
  tx: DbTransaction,
  locks: CertificationArtifactLock[],
): Promise<void> {
  for (const lock of sortedUniqueLocks(locks)) {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${certificationArtifactLockKey(lock)}))`,
    );
  }
}

/**
 * Same keys and order as `acquireCertificationArtifactLocksSorted`, but never
 * waits: returns false at the first artifact another transaction holds. Locks
 * taken before that stay held until the transaction ends, so a caller that
 * gets false must abort it.
 */
export async function tryAcquireCertificationArtifactLocksSorted(
  tx: DbTransaction,
  locks: CertificationArtifactLock[],
): Promise<boolean> {
  for (const lock of sortedUniqueLocks(locks)) {
    const result = await tx.execute<{ acquired: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(hashtext(${certificationArtifactLockKey(lock)})) AS acquired`,
    );
    if (!result.rows[0]?.acquired) return false;
  }
  return true;
}
