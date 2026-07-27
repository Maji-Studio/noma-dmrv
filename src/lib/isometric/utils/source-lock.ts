import { sql } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { ISOMETRIC_PROVIDER } from "./constants";

// Advisory-lock key for a (provider, documentId) pair. Mirroring, owning-record
// document deletion, and submit (per-document) all use this same key so the
// operations interlock. Submit cannot read a Source mapping while a concurrent
// owning-record edit retires it, then persist an orphaned externalDocumentId.
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
