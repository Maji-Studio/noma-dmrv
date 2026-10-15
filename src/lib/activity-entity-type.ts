import { isActivityEntityType, type ActivityEntityType } from "@/db/schema/common";

const ACTIVITY_ENTITY_TYPE_ALIASES = {
  productionRun: "production_run",
  biocharProduct: "biochar_product",
  labSample: "lab_sample",
  binMovement: "bin_movement",
  ghgStatement: "ghg_statement",
} as const satisfies Record<string, ActivityEntityType>;

export function toActivityEntityType(value: string): ActivityEntityType {
  if (isActivityEntityType(value)) return value;
  if (Object.hasOwn(ACTIVITY_ENTITY_TYPE_ALIASES, value)) {
    return ACTIVITY_ENTITY_TYPE_ALIASES[value as keyof typeof ACTIVITY_ENTITY_TYPE_ALIASES];
  }
  throw new Error(`Unknown activity entity type: ${value}`);
}
