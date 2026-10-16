/**
 * What an update changed, one line per field: `Label: old → new`. Pure so the
 * copy rules are unit-tested; the Activity view and the credit batch side
 * sheet render these lines through the one activity row.
 *
 * Values arrive as the server stored them: exact decimal strings, `YYYY-MM-DD`
 * days, ISO instants, enum strings, short labels and link ids (with current
 * names in `changeLabels`). A field named in `changedFields` but absent from
 * `changes` is name-only and reads "changed". A raw id is never shown.
 */
import { DOCUMENT_TYPE_LABELS } from "@/schemas/documents";
import { DISTANCE_SOURCE_LABELS } from "@/schemas/distance-source";
import { BIN_MOVEMENT_LANE_LABELS } from "@/schemas/bin-movements";
import {
  applicationEvidenceMethods,
  applicationMethods,
  formatApplicationEvidenceMethod,
  formatApplicationMethod,
  formatSoilTemperatureSource,
  soilTemperatureSources,
} from "@/schemas/applications";
import { formatVehicleType } from "@/schemas/vehicles";
import { documentOwnerActivityType, parseDocumentActivityReasonCode } from "@/lib/activity-entity-type";
import { humanizeEnum, MISSING_VALUE } from "@/lib/copy-utils";
import { formatCalendarDate, formatDateTime, formatDayString } from "@/lib/format-utils";
import { outputStockEventLabel } from "@/lib/output-stock/labels";
// By file, not the barrel (the forms barrel pulls in the form components).
import { ENTITY_TYPE_LABELS } from "@/components/forms/entity-select/entity-labels";
import type { EntityType } from "@/components/forms/entity-select/types";
import {
  ACTIVITY_RECORD_TYPE_LABELS,
  activityChangeSummary,
  activityFieldLabel,
  activityRecordTypeLabel,
  isHiddenActivityField,
  type ActivityItem,
} from "./activity-display";
import { isActivityEntityType } from "@/db/schema/common";

type ActivityChanges = NonNullable<ActivityItem["changes"]>;
type ActivityValue = ActivityChanges[string]["from"];
type ActivityChangeLabels = NonNullable<ActivityItem["changeLabels"]>;
type ChangeSide = "from" | "to";

export type ActivityValueTone = "value" | "missing" | "deleted";
export interface ActivityValueText {
  text: string;
  /** `missing` reads as a placeholder; `deleted` names a record that no longer exists, struck through. */
  tone: ActivityValueTone;
}

export type ActivityFieldLine =
  | { kind: "value"; key: string; label: string; from: ActivityValueText; to: ActivityValueText }
  /** The field changed but its values are not shown: name-only fields and unnamed links. */
  | { kind: "changed"; key: string; label: string }
  /** A status, drawn with the shared status badges like status events. */
  | { kind: "status"; key: string; label: string; from: string | null; to: string | null };

export const ACTIVITY_CHANGED_WORD = "changed";
export const ACTIVITY_NOT_SET = MISSING_VALUE.notSet;
const YES = "Yes";
const NO = "No";

// ─── GPS pairs ───────────────────────────────────────────────────────────────

interface GpsPair { label: string; latitude: string; longitude: string }

/** Coordinates that read as one point. */
const GPS_PAIRS: Partial<Record<string, readonly GpsPair[]>> = {
  application: [{ label: "GPS point", latitude: "gpsLatitude", longitude: "gpsLongitude" }],
  transport_leg: [
    { label: "Origin GPS point", latitude: "originGpsLatitude", longitude: "originGpsLongitude" },
    { label: "Destination GPS point", latitude: "destinationGpsLatitude", longitude: "destinationGpsLongitude" },
  ],
};

function gpsPairFor(entityType: string, field: string): GpsPair | undefined {
  return GPS_PAIRS[entityType]?.find((pair) => pair.latitude === field || pair.longitude === field);
}

/** A field's name in a list of names: a coordinate reads as its point. */
export function activityFieldNameLabel(entityType: string, field: string): string {
  return gpsPairFor(entityType, field)?.label ?? activityFieldLabel(entityType, field);
}

/** Field names, deduplicated, bookkeeping dropped: what a creation recorded. */
export function activityFieldNameLabels(item: Pick<ActivityItem, "entityType" | "changedFields">): string[] {
  const labels = item.changedFields
    .filter((field) => !isHiddenActivityField(field))
    .map((field) => activityFieldNameLabel(item.entityType, field));
  return [...new Set(labels)];
}

// ─── Values ──────────────────────────────────────────────────────────────────

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const DECIMAL_PATTERN = /^-?\d+(?:\.\d+)?$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Digits a double holds exactly; longer decimals are shown as stored. */
const MAX_EXACT_DIGITS = 15;
/** Intl's fraction-digit ceiling in older engines. */
const MAX_FRACTION_DIGITS = 20;

/** Short labels and identifiers shown as typed, even when they look like numbers. */
const VERBATIM_FIELDS = new Set([
  "code", "sampleCode", "labName", "labAccreditation", "fieldIdentifier", "cropType",
  "originName", "destinationName", "modelYear",
]);

/** Business dates still stored as UTC-midnight timestamps: they read as a day. */
const CALENDAR_DATE_FIELDS = new Set(["applicationDate", "deliveryDate", "orderDate"]);

function knownLabel<T extends string>(values: readonly T[], format: (value: T) => string) {
  return (value: string) => ((values as readonly string[]).includes(value) ? format(value as T) : humanizeEnum(value));
}

function labelMap(labels: Record<string, string>) {
  return (value: string) => (Object.hasOwn(labels, value) ? labels[value] : humanizeEnum(value));
}

/** Choices read in the forms' own words; anything unknown reads humanized. */
const ENUM_FORMATTERS: Record<string, (value: string) => string> = {
  applicationMethodType: knownLabel(applicationMethods, formatApplicationMethod),
  evidenceMethod: knownLabel(applicationEvidenceMethods, formatApplicationEvidenceMethod),
  soilTemperatureSource: knownLabel(soilTemperatureSources, formatSoilTemperatureSource),
  distanceSource: labelMap(DISTANCE_SOURCE_LABELS),
  recordedDistanceSource: labelMap(DISTANCE_SOURCE_LABELS),
  documentType: labelMap(DOCUMENT_TYPE_LABELS),
  lane: labelMap(BIN_MOVEMENT_LANE_LABELS),
  outputKind: outputStockEventLabel,
  vehicleType: formatVehicleType,
  entityType: (value) => activityRecordTypeLabel(documentOwnerActivityType(value) ?? value),
  movementType: humanizeEnum,
  sampling: humanizeEnum,
  certifier: humanizeEnum,
  packaging: humanizeEnum,
  provider: humanizeEnum,
  visibility: humanizeEnum,
  uploadStatus: humanizeEnum,
  transportMethodType: humanizeEnum,
  calculationMethodType: humanizeEnum,
};

/** A stored decimal with the app's grouping, keeping every stored digit. */
export function formatStoredDecimal(text: string): string {
  const fraction = text.split(".")[1] ?? "";
  const digits = text.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (digits.length > MAX_EXACT_DIGITS || fraction.length > MAX_FRACTION_DIGITS) return text;
  return Number(text).toLocaleString(undefined, {
    minimumFractionDigits: fraction.length,
    maximumFractionDigits: fraction.length,
  });
}

const value = (text: string): ActivityValueText => ({ text, tone: "value" });
const NOT_SET: ActivityValueText = { text: ACTIVITY_NOT_SET, tone: "missing" };

/** One stored value as it reads on the line. */
export function formatActivityValue(field: string, stored: ActivityValue): ActivityValueText {
  if (stored === null) return NOT_SET;
  if (typeof stored === "boolean") return value(stored ? YES : NO);
  const text = String(stored);
  if (Object.hasOwn(ENUM_FORMATTERS, field)) return value(ENUM_FORMATTERS[field](text));
  if (VERBATIM_FIELDS.has(field)) return value(text);
  if (DAY_PATTERN.test(text)) return value(formatDayString(text));
  if (INSTANT_PATTERN.test(text)) return value(CALENDAR_DATE_FIELDS.has(field) ? formatCalendarDate(text) : formatDateTime(text));
  if (DECIMAL_PATTERN.test(text)) return value(formatStoredDecimal(text));
  return value(text);
}

function isRawId(stored: ActivityValue): boolean {
  return typeof stored === "string" && UUID_PATTERN.test(stored);
}

// ─── Links ───────────────────────────────────────────────────────────────────

/** Link targets with no activity or entity-select name of their own. */
const LINK_RECORD_NOUNS: Record<string, string> = {
  production_process: "production process",
  submission: "submission",
  storage_inventory: "bin inventory",
  removal_template: "removal template",
};
/** Record type names that keep their capitals mid-sentence (GLOSSARY.md). */
const GLOSSARY_CAPITALISED = new Set(["Sample", "Removal", "GHG Statement"]);

const camelCase = (snake: string) => snake.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

/** The record type's name mid-sentence ("supplier", "storage bin"); glossary capitals stay. */
export function activityLinkRecordNoun(type: string): string {
  const entityKey = camelCase(type);
  if (Object.hasOwn(ENTITY_TYPE_LABELS, entityKey)) return ENTITY_TYPE_LABELS[entityKey as EntityType];
  if (Object.hasOwn(LINK_RECORD_NOUNS, type)) return LINK_RECORD_NOUNS[type];
  if (isActivityEntityType(type)) {
    const label = ACTIVITY_RECORD_TYPE_LABELS[type];
    return GLOSSARY_CAPITALISED.has(label) ? label : label.charAt(0).toLowerCase() + label.slice(1);
  }
  return humanizeEnum(type).toLowerCase();
}

/** Every record type a link field can point at, longest first so `customer_location` beats `customer`. */
const LINK_TARGET_TYPES = [
  ...new Set([
    ...Object.keys(ENTITY_TYPE_LABELS).map((key) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)),
    ...Object.keys(ACTIVITY_RECORD_TYPE_LABELS),
    ...Object.keys(LINK_RECORD_NOUNS),
  ]),
].sort((a, b) => b.length - a.length);

const OWNER_FIELD = "entityId";

/**
 * The record type a link field points at, read from its name: `supplierId`
 * is a supplier, `biocharStorageLocationId` a storage bin. A polymorphic
 * owner (`entityId`) takes the captured owner type, or a document's owner.
 * Unit-tested against the field policy so the two cannot drift.
 */
export function activityLinkTargetType(
  item: Pick<ActivityItem, "entityType" | "reasonCode" | "changes">,
  field: string,
  side: ChangeSide,
): string | null {
  if (field === OWNER_FIELD) {
    const owner = item.changes?.entityType?.[side] ?? parseDocumentActivityReasonCode(item.reasonCode)?.ownerType;
    if (typeof owner !== "string") return null;
    return documentOwnerActivityType(owner) ?? (owner === "biochar" ? "biochar_product" : owner);
  }
  const name = field.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().replace(/_id$/, "");
  return LINK_TARGET_TYPES.find((type) => name === type || name.endsWith(`_${type}`)) ?? null;
}

function linkSide(
  item: Pick<ActivityItem, "entityType" | "reasonCode" | "changes">,
  field: string,
  side: ChangeSide,
  label: ActivityChangeLabels[string][ChangeSide],
): ActivityValueText | null {
  if (!label) return NOT_SET;
  if (label.label) return value(label.label);
  if (!label.deleted) return null;
  const type = activityLinkTargetType(item, field, side);
  return { text: type ? `Deleted ${activityLinkRecordNoun(type)}` : "Deleted record", tone: "deleted" };
}

// ─── Lines ───────────────────────────────────────────────────────────────────

const STATUS_FIELD = "status";
/** A run's batch membership: its summary line already says it. */
const MEMBERSHIP_FIELD = "credit_batch";

function coordinateText(latitude: ActivityValue, longitude: ActivityValue): ActivityValueText {
  if (latitude === null && longitude === null) return NOT_SET;
  const part = (coordinate: ActivityValue) => (coordinate === null ? ACTIVITY_NOT_SET : String(coordinate));
  return value(`${part(latitude)}, ${part(longitude)}`);
}

function gpsLine(item: Pick<ActivityItem, "entityType">, changes: ActivityChanges, pair: GpsPair): ActivityFieldLine {
  const latitude = changes[pair.latitude];
  const longitude = changes[pair.longitude];
  if (latitude && longitude) {
    return {
      kind: "value", key: pair.label, label: pair.label,
      from: coordinateText(latitude.from, longitude.from),
      to: coordinateText(latitude.to, longitude.to),
    };
  }
  // One coordinate changed; the other was not captured, so it is not invented.
  const field = latitude ? pair.latitude : longitude ? pair.longitude : null;
  if (!field) return { kind: "changed", key: pair.label, label: pair.label };
  const change = changes[field];
  return {
    kind: "value", key: field, label: activityFieldLabel(item.entityType, field),
    from: change.from === null ? NOT_SET : value(String(change.from)),
    to: change.to === null ? NOT_SET : value(String(change.to)),
  };
}

function fieldLine(
  item: Pick<ActivityItem, "entityType" | "reasonCode" | "changes" | "changeLabels">,
  field: string,
): ActivityFieldLine {
  const label = activityFieldLabel(item.entityType, field);
  const changed: ActivityFieldLine = { kind: "changed", key: field, label };
  const change = item.changes?.[field];
  if (!change) return changed;
  if (field === STATUS_FIELD) {
    const text = (stored: ActivityValue) => (stored === null ? null : String(stored));
    return { kind: "status", key: field, label, from: text(change.from), to: text(change.to) };
  }
  const link = item.changeLabels?.[field];
  if (link) {
    const from = linkSide(item, field, "from", link.from);
    const to = linkSide(item, field, "to", link.to);
    return from && to ? { kind: "value", key: field, label, from, to } : changed;
  }
  if (isRawId(change.from) || isRawId(change.to)) return changed;
  return { kind: "value", key: field, label, from: formatActivityValue(field, change.from), to: formatActivityValue(field, change.to) };
}

/**
 * One line per changed field of an update, in the order the server listed
 * them; a coordinate pair reads as one GPS point. Creations list field names
 * instead (`activityFieldNameLabels`), and deletions and registry status
 * events list none.
 */
export function activityFieldLines(item: ActivityItem): ActivityFieldLine[] {
  if (item.action !== "updated") return [];
  const changes = item.changes ?? {};
  const membership = activityChangeSummary(item) !== null;
  const fields = [...new Set([...item.changedFields, ...Object.keys(changes)])]
    .filter((field) => !isHiddenActivityField(field) && !(membership && field === MEMBERSHIP_FIELD));
  const lines: ActivityFieldLine[] = [];
  const seen = new Set<string>();
  for (const field of fields) {
    const pair = gpsPairFor(item.entityType, field);
    const line = pair ? gpsLine(item, changes, pair) : fieldLine(item, field);
    if (seen.has(line.key)) continue;
    seen.add(line.key);
    lines.push(line);
  }
  return lines;
}
