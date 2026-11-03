"use client";

import { Notice } from "@/components/ui/notice";
import { useRecordLock } from "@/hooks/use-record-locks";
import { formatRecordFilesLockedMessage } from "@/lib/certification/lineage-lock-message";
import type { RecordLockViewKind } from "@/lib/record-lock-view";

/**
 * The line a document panel shows above its files once its record is locked,
 * read from the same lock as the record header so both say interrupted or
 * submitted alike (#1528). Without a lock kind (a manual transport leg) it
 * keeps the submitted line.
 */
export function RecordFilesLockedNotice({ lockKind, lockId }: { lockKind?: RecordLockViewKind; lockId?: string | null }) {
  const { lock } = useRecordLock(lockKind ?? "removal", lockKind ? lockId : null);
  return <Notice tone="info">{formatRecordFilesLockedMessage(lock)}</Notice>;
}
