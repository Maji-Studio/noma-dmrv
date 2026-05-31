import { sql } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { ISOMETRIC_PROVIDER } from "./constants";

// Advisory-lock key for a (provider, documentId) pair. mirror, unlink, and
// submit (per-document) all use this same key so the three operations
// interlock — closing the unlink↔submit window where submit could read a
// source, unlink could delete the mapping, and submit would then write a
// snapshot referencing an orphaned externalDocumentId.
export function mirrorLockKey(documentId: string): string {
  return `mirror:${ISOMETRIC_PROVIDER}:${documentId}`;
}

export async function acquireMirrorLock(
  tx: DbTransaction,
  documentId: string,
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${mirrorLockKey(documentId)}))`,
  );
}

// Acquires per-document mirror locks for the full candidate set in
// deterministic order. Sorting prevents the ABBA deadlock where two
// concurrent submits with overlapping (but unequally-ordered) candidate sets
// would each hold one lock and wait for the other.
export async function acquireMirrorLocksSorted(
  tx: DbTransaction,
  documentIds: string[],
): Promise<void> {
  const sorted = [...documentIds].sort();
  for (const docId of sorted) {
    await acquireMirrorLock(tx, docId);
  }
}
