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

/** Preserve document ownership in activity without copying file details. */
export function documentActivityReasonCode(document: { documentType: string; entityType: string; entityId: string }): string {
  return `document:${document.documentType}:${toActivityDocumentOwnerType(document.entityType)}:${document.entityId}`;
}

export interface DocumentActivityReason {
  documentType: string;
  ownerType: string;
  ownerId: string;
}

/** Reads `documentActivityReasonCode` back. Document types may contain colons; the owner is always the last two parts. */
export function parseDocumentActivityReasonCode(reasonCode: string | null | undefined): DocumentActivityReason | null {
  if (!reasonCode?.startsWith("document:")) return null;
  const parts = reasonCode.split(":");
  if (parts.length < 4) return null;
  return { documentType: parts.slice(1, -2).join(":"), ownerType: parts.at(-2)!, ownerId: parts.at(-1)! };
}

/** The activity type of a document owner, when the owner is a record with activity of its own. */
export function documentOwnerActivityType(ownerType: string): ActivityEntityType | null {
  const type = polymorphicOwnerActivityType(ownerType);
  return isActivityEntityType(type) ? type : null;
}

/** Shared owner spellings for documents and transport legs; reference-data types pass through. */
export function polymorphicOwnerActivityType(ownerType: string): string {
  if (ownerType === "sample") return "lab_sample";
  if (ownerType === "biochar") return "biochar_product";
  return ownerType;
}
