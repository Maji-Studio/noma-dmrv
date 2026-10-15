import type { ActivityEntityType } from "@/db/schema/activity";

const ACTIVITY_ENTITY_TYPE_MAP = {
  removal: "removal",
  ghg_statement: "ghg_statement",
  production_run: "production_run",
  biochar_product: "biochar_product",
  lab_sample: "lab_sample",
  order: "order",
  delivery: "delivery",
  application: "application",
  credit_batch: "credit_batch",
  document: "document",
  transport_leg: "transport_leg",
  feedstock: "feedstock",
  bin_movement: "bin_movement",
  productionRun: "production_run",
  biocharProduct: "biochar_product",
  labSample: "lab_sample",
  binMovement: "bin_movement",
  ghgStatement: "ghg_statement",
} as const satisfies Record<string, ActivityEntityType>;

export function toActivityEntityType(value: string): ActivityEntityType {
  if (!Object.hasOwn(ACTIVITY_ENTITY_TYPE_MAP, value)) {
    throw new Error(`Unknown activity entity type: ${value}`);
  }
  return ACTIVITY_ENTITY_TYPE_MAP[value as keyof typeof ACTIVITY_ENTITY_TYPE_MAP];
}
