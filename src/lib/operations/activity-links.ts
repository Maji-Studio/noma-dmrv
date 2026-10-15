import type { ActivityEntityType } from "@/db/schema/common";
import type { ActivityEventInput } from "@/data-access/activity-events";

type ActivityLinks = Pick<ActivityEventInput, "facilityId" | "productionRunId" | "creditBatchId">;

/** Private to one execution attempt; never included in business results. */
export function createOperationActivity() {
  let skipped = false;
  let shared: ActivityLinks = {};
  const entities = new Map<string, ActivityLinks>();
  return {
    skip: () => { skipped = true; },
    link: (links: ActivityLinks, entityId?: string) => {
      if (entityId === undefined) shared = { ...shared, ...links };
      else entities.set(entityId, { ...entities.get(entityId), ...links });
    },
    get skipped() { return skipped; },
    links: (entityType: ActivityEntityType, entityId: string): ActivityLinks => ({
      facilityId: undefined, creditBatchId: undefined, productionRunId: undefined,
      ...shared, ...entities.get(entityId),
      ...(entityType === "production_run" ? { productionRunId: entityId } : {}),
      ...(entityType === "credit_batch" ? { creditBatchId: entityId } : {}),
    }),
  };
}

export type OperationActivity = Pick<ReturnType<typeof createOperationActivity>, "skip" | "link">;

export function singleProductionRunId(ids: readonly (string | null | undefined)[]): string | undefined {
  const unique = [...new Set(ids.filter((id): id is string => id != null))];
  return unique.length === 1 ? unique[0] : undefined;
}

export function linkDocumentActivity(activity: OperationActivity, document: { entityType: string; entityId: string }) {
  if (document.entityType === "production_run") activity.link({ productionRunId: document.entityId });
  if (document.entityType === "credit_batch") activity.link({ creditBatchId: document.entityId });
}
