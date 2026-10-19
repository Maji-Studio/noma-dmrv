"use client";

import { useQuery } from "@tanstack/react-query";
import { loadRecordCertificationLock } from "@/fn/record-certification-lock";
import type { DocumentEntityType } from "@/schemas/documents";
import { unwrap } from "./types";
import { certificationKeys } from "./use-certification";

/**
 * Whether the record's lineage holds a submitted Removal or GHG statement, so
 * its files cannot change. Advisory: the document writers decide.
 */
export function useRecordCertificationLock(
  entityType: DocumentEntityType,
  entityId?: string | null,
) {
  return useQuery({
    queryKey: certificationKeys.recordLock(entityType, entityId ?? undefined),
    enabled: !!entityId,
    queryFn: async () =>
      unwrap(await loadRecordCertificationLock(entityType, entityId!)),
  });
}

/** True only once the read confirms the lock; panels stay editable meanwhile. */
export function useIsRecordCertificationLocked(
  entityType: DocumentEntityType,
  entityId?: string | null,
): boolean {
  return useRecordCertificationLock(entityType, entityId).data === true;
}

