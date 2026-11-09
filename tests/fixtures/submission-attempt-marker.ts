import type { CertificationSubmissionRow } from "@/data-access/certification";

/** In-memory counterpart of the guarded writer; SQL guard coverage is DB-backed. */
export function markAttemptStartedFake(
  rows: CertificationSubmissionRow[],
  organizationId: string,
  id: string,
  expectedLockedAt: Date,
): boolean {
  const row = rows.find((candidate) => candidate.id === id);
  if (!row || row.organizationId !== organizationId || row.status !== "draft" ||
    row.lockedAt?.getTime() !== expectedLockedAt.getTime()) return false;
  const metadata = (row.metadata ?? {}) as Record<string, unknown>;
  row.metadata = { ...metadata, externalMutation:
    metadata.externalMutation === "confirmed" ? "confirmed" : "possible" };
  return true;
}

export function clearAttemptMetadataFake(row: CertificationSubmissionRow): void {
  row.metadata = Object.fromEntries(Object.entries(row.metadata ?? {}).filter(
    ([key]) => !["lastError", "lastAttemptOutcome", "externalMutation"].includes(key),
  ));
}
