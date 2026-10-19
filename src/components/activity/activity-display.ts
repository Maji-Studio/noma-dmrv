/**
 * How one activity event reads: record type, kind, who, the record's deep link
 * and the names of the fields it touched. Pure so the copy rules are
 * unit-tested; the list and the side sheet render through it so both read
 * alike. The values an update recorded (`changes`, with current link names in
 * `changeLabels`) become one line per field in `activity-change-lines.ts`.
 */
import type { CreditBatchActivityPage } from "@/data-access/credit-batch-activity";
import {
  isActivityEntityType,
  type ActivityEntityType,
} from "@/db/schema/common";
import { CERTIFY_FIELD_REGISTRY, type CertifyEntityKind } from "@/lib/certification/certify-field-registry";
import { applicationDeepLinkHref } from "@/lib/application-links";
import { certificationRemovalsHref, productionRunDeepLinkHref } from "@/lib/certification/links";
import { creditBatchDeepLinkHref } from "@/lib/credit-batch-links";
import { deliveryDeepLinkHref } from "@/lib/delivery-links";
import { orderDeepLinkHref } from "@/lib/order-links";
import { feedstockDeepLinkHref } from "@/lib/feedstock-links";
import { biocharProductDeepLinkHref } from "@/lib/biochar-product-links";
import { ghgStatementDeepLinkHref } from "@/lib/ghg-statement-links";
import { sampleDetailHref } from "@/lib/sample-create-intent";
import { documentOwnerActivityType, parseDocumentActivityReasonCode } from "@/lib/activity-entity-type";
import { humanizeEnum, MISSING_VALUE } from "@/lib/copy-utils";
import { DRY_MASS_FIELD_LABEL, MOISTURE_FIELD_LABEL, WET_MASS_FIELD_LABEL } from "@/lib/mass-moisture";
import { DOCUMENT_TYPE_LABELS, type DocumentType } from "@/schemas/documents";

export type ActivityItem = CreditBatchActivityPage["items"][number];
export type ActivityAction = ActivityItem["action"];
export type ActivitySource = ActivityItem["source"];

/** The kinds in the order an operator reads a record's life. */
export const ACTIVITY_KIND_ORDER = ["created", "updated", "status_changed", "deleted"] as const satisfies readonly ActivityAction[];

export const ACTIVITY_KIND_LABELS: Record<ActivityAction, string> = {
  created: "Created",
  updated: "Updated",
  status_changed: "Status changed",
  deleted: "Deleted",
};

/** Glossary names (GLOSSARY.md): Sample, Removal and GHG Statement keep their capitals. */
export const ACTIVITY_RECORD_TYPE_LABELS: Record<ActivityEntityType, string> = {
  emission_entry: "Emissions entry",
  emission_line_comment: "Line comment",
  credit_batch: "Credit batch",
  production_run: "Production run",
  feedstock: "Feedstock",
  biochar_product: "Biochar product",
  bin_movement: "Bin movement",
  lab_sample: "Sample",
  order: "Order",
  delivery: "Delivery",
  transport_leg: "Transport leg",
  application: "Application",
  document: "Document",
  supplier: "Supplier",
  supplier_location: "Supplier location",
  customer: "Customer",
  customer_location: "Customer location",
  formulation: "Formulation",
  removal: "Removal",
  ghg_statement: "GHG Statement",
};

/** Record types in custody order, then master data, for the record type filter. */
export const ACTIVITY_RECORD_TYPE_ORDER: readonly ActivityEntityType[] = [
  "credit_batch", "emission_entry", "emission_line_comment", "feedstock", "production_run", "biochar_product", "bin_movement", "lab_sample",
  "order", "delivery", "transport_leg", "application", "document",
  "supplier", "supplier_location", "customer", "customer_location", "formulation",
  "removal", "ghg_statement",
];

export function activityRecordTypeLabel(entityType: string): string {
  return isActivityEntityType(entityType) ? ACTIVITY_RECORD_TYPE_LABELS[entityType] : humanizeEnum(entityType);
}

/** Who did it, when there is no person: the source acts on its own. */
const ACTORLESS_SOURCE_LABELS: Partial<Record<ActivitySource, string>> = {
  system: "System",
  registry: "Registry",
  script: "Script",
};

/** How a person's change reached noma, when it was not the app's own forms. */
const SOURCE_CHANNEL_LABELS: Partial<Record<ActivitySource, string>> = {
  rest: "API",
  mcp: "MCP",
  registry: "registry",
  script: "script",
};

export interface ActivityActorDisplay {
  /** The person's name, or the source standing in for one. */
  name: string;
  /** True when the name is a missing-value token rather than a name. */
  missing: boolean;
  /** "via API" and the like; null for changes made in the app. */
  channel: string | null;
}

export function activityActorDisplay(item: Pick<ActivityItem, "actor" | "source">): ActivityActorDisplay {
  if (!item.actor) {
    const name = ACTORLESS_SOURCE_LABELS[item.source];
    return name ? { name, missing: false, channel: null } : { name: MISSING_VALUE.notAvailable, missing: true, channel: null };
  }
  const channel = SOURCE_CHANNEL_LABELS[item.source];
  return {
    name: item.actor.name ?? MISSING_VALUE.notAvailable,
    missing: item.actor.name == null,
    channel: channel ? `via ${channel}` : null,
  };
}

/** The actor as one phrase: the name, then "via API" and the like when the change came through a channel. */
export function activityActorText(actor: ActivityActorDisplay): string {
  return actor.channel ? `${actor.name} ${actor.channel}` : actor.name;
}

/** Field names the activity writers use that no form owns. */
const ACTIVITY_FIELD_LABELS: Record<string, string> = {
  production_runs: "Production runs",
  emission_entry: "Emissions entry",
  credit_batch: "Credit batch",
  removalAssignment: "Removal assignment",
  productionClaimReservation: "Production claim reservation",
  productionClaim: "Production claim",
  uploadStatus: "Upload status",
  removalTemplateId: "Removal template",
  // The shared mass and moisture names (docs/design-system.md, wet/dry mass).
  massWetKg: WET_MASS_FIELD_LABEL,
  wetMassKg: WET_MASS_FIELD_LABEL,
  massDryKg: DRY_MASS_FIELD_LABEL,
  dryMassKg: DRY_MASS_FIELD_LABEL,
  moistureContentPercent: MOISTURE_FIELD_LABEL,
  moisturePercent: MOISTURE_FIELD_LABEL,
  ph: "pH",
  gisBoundary: "Boundary",
  gpsLatitude: "GPS latitude",
  gpsLongitude: "GPS longitude",
  originGpsLatitude: "Origin GPS latitude",
  originGpsLongitude: "Origin GPS longitude",
  destinationGpsLatitude: "Destination GPS latitude",
  destinationGpsLongitude: "Destination GPS longitude",
  // A document's or transport leg's owner.
  entityType: "Linked record type",
  entityId: "Linked record",
};
/** Bookkeeping fields every save touches; they say nothing to an operator. */
const HIDDEN_FIELDS = new Set(["version", "expectedVersion", "facilityId", "organizationId"]);

export function isHiddenActivityField(field: string): boolean {
  return HIDDEN_FIELDS.has(field);
}

const CERTIFY_KIND_BY_ENTITY: Partial<Record<ActivityEntityType, CertifyEntityKind>> = {
  production_run: "productionRun",
  lab_sample: "sample",
  feedstock: "feedstock",
  transport_leg: "transportLeg",
  delivery: "delivery",
  application: "application",
};

/**
 * Unit suffixes on field keys, read as the unit symbol the forms show. The
 * first match wins, so compound units come before the plain ones they end in.
 */
const UNIT_SUFFIXES: ReadonlyArray<[RegExp, string]> = [
  [/ kg hr$/, " (kg/h)"],
  [/ kg (per )?m3$/, " (kg/m³)"],
  [/ g ?per kg$/, " (g/kg)"], // "GPerKg" splits as "gper kg"
  [/ kg$/, " (kg)"],
  [/ km$/, " (km)"],
  [/ kwh$/, " (kWh)"],
  [/ (litres|liters)$/, " (L)"],
  [/ percent$/, " (%)"],
  [/ (tons|tonnes)$/, " (t)"],
  [/ ha$/, " (ha)"],
  [/ c$/, " (°C)"],
  [/ minutes$/, " (min)"],
  [/ grams$/, " (g)"],
  [/ ml$/, " (mL)"],
  [/ ppm$/, " (ppm)"],
];

function fieldWords(field: string): string {
  return field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .trim()
    .toLowerCase()
    .replace(/ ids?$/, (match) => (match.endsWith("s") ? "s" : ""));
}

/** "biocharOutputKg" → "Biochar output (kg)"; a trailing id names the relation. */
export function humanizeFieldName(field: string): string {
  let words = fieldWords(field);
  const unit = UNIT_SUFFIXES.find(([suffix]) => suffix.test(words));
  if (unit) words = words.replace(unit[0], unit[1]);
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The unit a field key names, as its label suffix (" (kg)"), or "". */
function fieldUnitSuffix(field: string): string {
  const words = fieldWords(field);
  return UNIT_SUFFIXES.find(([suffix]) => suffix.test(words))?.[1] ?? "";
}

/**
 * The form label for a changed field where one is known, else a readable name.
 * Registry labels name the quantity without its unit, so the unit the key
 * carries is added: values on an activity line never repeat it.
 */
export function activityFieldLabel(entityType: string, field: string): string {
  const known = ACTIVITY_FIELD_LABELS[field];
  if (known) return known;
  const kind = isActivityEntityType(entityType) ? CERTIFY_KIND_BY_ENTITY[entityType] : undefined;
  const descriptor = kind
    ? CERTIFY_FIELD_REGISTRY[kind].find((entry) => entry.key === field || entry.formFields?.includes(field))
    : undefined;
  if (!descriptor) return humanizeFieldName(field);
  return descriptor.label.includes("(") ? descriptor.label : `${descriptor.label}${fieldUnitSuffix(field)}`;
}

function documentTypeLabel(documentType: string): string | null {
  return Object.hasOwn(DOCUMENT_TYPE_LABELS, documentType) ? DOCUMENT_TYPE_LABELS[documentType as DocumentType] : null;
}

/** The record's name: its code, or for a document the document type. */
export function activityRecordLabel(item: Pick<ActivityItem, "entityType" | "reasonCode" | "record">): string | null {
  if (item.entityType === "document") {
    const reason = parseDocumentActivityReasonCode(item.reasonCode);
    // The type names the file; the server's generic "Document" would repeat the record type.
    return reason ? documentTypeLabel(reason.documentType) : null;
  }
  return item.record.label;
}

/** What membership and status events mean, in words. Null when the kind says it all. */
export function activityChangeSummary(item: Pick<ActivityItem, "entityType" | "reasonCode">): string | null {
  if (item.entityType === "production_run" && item.reasonCode === "attached") return "Added to this credit batch";
  if (item.entityType === "production_run" && item.reasonCode === "detached") return "Removed from this credit batch";
  return null;
}

/**
 * A status as the shared status vocabulary keys it. Registry statuses arrive
 * upper case ("VERIFIED"); local ones are already lower snake case.
 */
export function activityStatusKey(status: string): string {
  return status.toLowerCase();
}

/**
 * Where the record opens: its list's side sheet, on the facility the record
 * lives at now (resolved with its label, so a run moved to another facility
 * still opens). A document opens its owner, which holds its files.
 * Null for tombstones, records with no known facility or no sheet of their own
 * (transport legs, bin movements), and the batch the list is already about.
 */
export function activityRecordHref(
  item: Pick<ActivityItem, "entityType" | "entityId" | "reasonCode" | "record">,
  context: { creditBatchId: string },
): string | null {
  const facility = item.record.facilityId;
  if (item.record.deleted || !facility) return null;
  let entityType: string = item.entityType;
  let entityId = item.entityId;
  if (entityType === "document") {
    const reason = parseDocumentActivityReasonCode(item.reasonCode);
    const ownerType = reason && documentOwnerActivityType(reason.ownerType);
    if (!reason || !ownerType) return null;
    entityType = ownerType;
    entityId = reason.ownerId;
  }
  switch (entityType) {
    case "credit_batch":
      return entityId === context.creditBatchId ? null : creditBatchDeepLinkHref(entityId, facility);
    case "production_run": return productionRunDeepLinkHref(entityId, facility);
    case "feedstock": return feedstockDeepLinkHref(entityId, facility);
    case "biochar_product": return biocharProductDeepLinkHref(entityId, facility);
    case "lab_sample": return sampleDetailHref(facility, entityId);
    case "order": return orderDeepLinkHref(entityId, facility);
    case "delivery": return deliveryDeepLinkHref(entityId, facility);
    case "application": return applicationDeepLinkHref(entityId, facility);
    case "removal": return certificationRemovalsHref({ facility, removal: entityId });
    case "ghg_statement": return ghgStatementDeepLinkHref(entityId, facility);
    default: return null;
  }
}
