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

export async function acquireCertificationArtifactLocksSorted(
  tx: DbTransaction,
  locks: CertificationArtifactLock[],
): Promise<void> {
  const deduped = Array.from(
    new Map(locks.map((lock) => [certificationArtifactLockKey(lock), lock]))
      .values(),
  ).sort((a, b) =>
    certificationArtifactLockKey(a).localeCompare(
      certificationArtifactLockKey(b),
    ),
  );

  for (const lock of deduped) {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${certificationArtifactLockKey(lock)}))`,
    );
  }
}
