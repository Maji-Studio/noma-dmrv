import type { QueryClient } from "@tanstack/react-query";
import { isActionError } from "@/lib/action-error";
import { RECORD_LOCK_VIEW_KINDS, type RecordLockViewKind } from "@/lib/record-lock-view";
import { recordLockMeta, RECORD_LOCK_TOUCHES } from "./record-lock-query-keys";
import { documentKeys } from "./document-query-keys";
import { certificationKeys } from "./use-certification";

type Owner = { entityType: string; entityId?: string };
const OWNER_KINDS: Record<string, RecordLockViewKind> = {
  production_run: "productionRun", biochar_product: "biocharProduct",
  credit_batch: "creditBatch", storage_location: "storageLocation",
};
function asOwner(value: unknown): Owner | undefined {
  if (typeof value !== "object" || value === null || !("entityType" in value) || typeof value.entityType !== "string") return;
  return { entityType: value.entityType, entityId: "entityId" in value && typeof value.entityId === "string" ? value.entityId : undefined };
}

/** Upload variables carry the owner; later document writes can recover it from the list cache. */
export function documentLockRefresh(client: QueryClient, owner?: Owner, invalidateKey?: readonly unknown[]) {
  function resolveOwner(variables: unknown): Owner | undefined {
    const explicit = asOwner(variables);
    if (explicit) return explicit;
    if (owner?.entityId) return owner;
    if (invalidateKey?.[0] === documentKeys.all[0] && typeof invalidateKey[1] === "string" && typeof invalidateKey[2] === "string") {
      return { entityType: invalidateKey[1], entityId: invalidateKey[2] };
    }
    const id = typeof variables === "string" ? variables
      : typeof variables === "object" && variables !== null && "documentId" in variables ? variables.documentId : undefined;
    for (const [, rows] of client.getQueriesData({ queryKey: documentKeys.all })) {
      if (!Array.isArray(rows)) continue;
      const row: unknown = rows.find(row => row?.id === id);
      const cached = asOwner(row);
      if (cached) return cached;
    }
    return owner;
  }
  return {
    meta: recordLockMeta(variables => {
      const resolved = resolveOwner(variables);
      if (!resolved) return RECORD_LOCK_TOUCHES.document;
      const kind = OWNER_KINDS[resolved.entityType] ?? RECORD_LOCK_VIEW_KINDS.find(kind => kind === resolved.entityType);
      return kind ? [kind] : resolved.entityType === "transport_leg" ? RECORD_LOCK_TOUCHES.transport : [];
    }, { onRefusalOnly: true }),
    onError: (error: unknown, variables: unknown) => {
      if (!isActionError(error) || error.code !== "certification_locked") return;
      const resolved = resolveOwner(variables);
      void client.invalidateQueries({ queryKey: resolved?.entityId
        ? certificationKeys.recordLock(resolved.entityType, resolved.entityId)
        : certificationKeys.recordLocks() });
    },
  };
}
