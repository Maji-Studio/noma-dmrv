import type { ActivityEntityType } from "@/db/schema/common";
import type { ActivityEventInput } from "@/data-access/activity-events";

type ActivityLinks = Pick<ActivityEventInput, "facilityId" | "productionRunId" | "creditBatchId">;

const RESULT_RECORD_KEYS = ["product", "sample", "order", "delivery", "movement"] as const;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function id(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function onlyRun(ids: unknown[]): string | undefined {
  const unique = [...new Set(ids.map(id).filter((value) => value !== undefined))];
  return unique.length === 1 ? unique[0] : undefined;
}

/** Use only returned identifiers, never extra reads or arbitrary request fields. */
export function operationActivityLinks(output: unknown, entityType: ActivityEntityType, entityId: string): ActivityLinks {
  const result = record(output);
  const candidates = [result, ...RESULT_RECORD_KEYS.map((key) => record(result?.[key])),
    ...(Array.isArray(result?.feedstocks) ? result.feedstocks.map(record) : [])];
  const row = candidates.find((candidate) => candidate?.id === entityId || (entityType === "bin_movement" && candidate?.movementId === entityId));
  const links: ActivityLinks = {
    facilityId: id(row?.facilityId),
    creditBatchId: entityType === "credit_batch" ? entityId : id(row?.creditBatchId),
    productionRunId: entityType === "production_run" ? entityId : id(row?.productionRunId),
  };
  if (entityType === "biochar_product") {
    const allocations = Array.isArray(row?.sourceAllocations) ? row.sourceAllocations : [];
    links.productionRunId = id(row?.linkedProductionRunId) ?? onlyRun(allocations.map((allocation) => record(allocation)?.productionRunId));
  }
  if (entityType === "bin_movement") {
    const allocations = record(result?.preview)?.allocations;
    const runs = Array.isArray(allocations) ? allocations.flatMap((allocation) => {
      const sources = record(allocation)?.runs;
      return Array.isArray(sources) ? sources.map((source) => record(source)?.productionRunId) : [];
    }) : [];
    links.productionRunId = onlyRun(Array.isArray(row?.productionRunIds) ? row.productionRunIds : runs);
  }
  return links;
}
