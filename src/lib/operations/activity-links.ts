import { diffActivityChanges, type CaptureActivity, type ActivitySnapshot } from "@/lib/activity-changes";
import type { ActivityEntityType } from "@/db/schema/common";
import type { ActivityEventInput } from "@/data-access/activity-events";
import { documentActivityReasonCode } from "@/lib/activity-entity-type";

import type { OperationDescription } from "@/lib/operation-effect";

type ActivityLinks = Pick<ActivityEventInput, "facilityId" | "productionRunId" | "creditBatchId" | "reasonCode">;

/** Private to one execution attempt; never included in business results. */
export function createOperationActivity() {
  let skipped = false;
  const extraEffects: (OperationDescription & { diff: typeof diff })[] = [];
  const snapshots = new Map<string, { before: ActivitySnapshot | null; after: ActivitySnapshot | null }>();
  const capture: CaptureActivity = (id, before, after) => { snapshots.set(id, { before, after }); };
  const diff = (type: ActivityEntityType, id: string) => {
    const snapshot = snapshots.get(id);
    return diffActivityChanges(type, snapshot?.before ?? null, snapshot?.after ?? null);
  };
  let shared: ActivityLinks = {};
  const entities = new Map<string, ActivityLinks>();
  const scopes = new Map<string, ActivityLinks[]>();
  const links = (entityType: ActivityEntityType, entityId: string): ActivityLinks => ({
    facilityId: undefined, creditBatchId: undefined, productionRunId: undefined,
    ...shared, ...entities.get(entityId),
    ...(entityType === "production_run" ? { productionRunId: entityId } : {}),
    ...(entityType === "credit_batch" ? { creditBatchId: entityId } : {}),
  });
  return {
    extra: (effect: OperationDescription) => {
      // Freeze this event's captures before another event for the same child replaces them.
      const captured = new Map(effect.entityIds.map(id => [id, snapshots.get(id)]));
      extraEffects.push({ ...effect, diff: (type, id) => {
        const snapshot = captured.get(id);
        return diffActivityChanges(type, snapshot?.before ?? null, snapshot?.after ?? null);
      } });
    },
    get extraEffects() { return extraEffects; },
    capture,
    diff,
    skip: () => { skipped = true; },
    link: (links: ActivityLinks, entityId?: string) => {
      if (entityId === undefined) shared = { ...shared, ...links };
      else entities.set(entityId, { ...entities.get(entityId), ...links });
    },
    /** One event per scope, as non-runner writers record per affected batch. */
    scope: (entityId: string, entityScopes: readonly ActivityLinks[]) => {
      const unique = new Map(entityScopes.map(scope => [`${scope.creditBatchId ?? ""}:${scope.productionRunId ?? ""}`, scope]));
      scopes.set(entityId, [...unique.values()]);
    },
    get skipped() { return skipped; },
    links,
    scopedLinks: (entityType: ActivityEntityType, entityId: string): ActivityLinks[] =>
      (scopes.get(entityId) ?? [{}]).map(scope => ({ ...links(entityType, entityId), ...scope })),
  };
}

export type OperationActivity = Pick<ReturnType<typeof createOperationActivity>, "skip" | "link" | "scope" | "capture" | "extra">;

export function singleProductionRunId(ids: readonly (string | null | undefined)[]): string | undefined {
  const unique = [...new Set(ids.filter((id): id is string => id != null))];
  return unique.length === 1 ? unique[0] : undefined;
}

export function linkDocumentActivity(activity: OperationActivity, document: { documentType: string; entityType: string; entityId: string }) {
  activity.link({ reasonCode: documentActivityReasonCode(document) });
  if (document.entityType === "production_run") activity.link({ productionRunId: document.entityId });
  if (document.entityType === "credit_batch") activity.link({ creditBatchId: document.entityId });
}
