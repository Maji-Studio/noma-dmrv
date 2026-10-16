import type { ActivityEntityType } from "@/db/schema/common";
import type { ActivityEventInput } from "@/data-access/activity-events";
import { documentActivityReasonCode } from "@/lib/activity-entity-type";

import type { OperationEffect } from "@/lib/operation-effect";

type ActivityLinks = Pick<ActivityEventInput, "facilityId" | "productionRunId" | "creditBatchId" | "reasonCode">;

/** Private to one execution attempt; never included in business results. */
export function createOperationActivity() {
  let skipped = false;
  const extraEffects: OperationEffect[] = [];
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
    extra: (effect: OperationEffect) => { extraEffects.push(effect); },
    get extraEffects(): readonly OperationEffect[] { return extraEffects; },
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

export type OperationActivity = Pick<ReturnType<typeof createOperationActivity>, "skip" | "link" | "scope" | "extra">;

export function singleProductionRunId(ids: readonly (string | null | undefined)[]): string | undefined {
  const unique = [...new Set(ids.filter((id): id is string => id != null))];
  return unique.length === 1 ? unique[0] : undefined;
}

export function linkDocumentActivity(activity: OperationActivity, document: { documentType: string; entityType: string; entityId: string }) {
  activity.link({ reasonCode: documentActivityReasonCode(document) });
  if (document.entityType === "production_run") activity.link({ productionRunId: document.entityId });
  if (document.entityType === "credit_batch") activity.link({ creditBatchId: document.entityId });
}
