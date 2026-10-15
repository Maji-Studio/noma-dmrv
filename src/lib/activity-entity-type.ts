import { isActivityEntityType, type ActivityEntityType } from "@/db/schema/common";
import { DOCUMENT_ENTITY_TYPES } from "@/schemas/documents";

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

/** Document owners also include reference data and child records without entity events. */
export function toActivityDocumentOwnerType(value: string): string {
  if (DOCUMENT_ENTITY_TYPES.some(type => type === value)) return value;
  if (value === "ghgStatementReport" || value === "ghg_statement_report") return "ghg_statement_report";
  return toActivityEntityType(value);
}
