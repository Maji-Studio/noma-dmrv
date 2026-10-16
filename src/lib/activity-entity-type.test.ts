import { expect, it } from "vitest";
import { documentOwnerActivityType, polymorphicOwnerActivityType, parseDocumentActivityReasonCode, toActivityDocumentOwnerType, toActivityEntityType } from "@/lib/activity-entity-type";
import { DOCUMENT_ENTITY_TYPES } from "@/schemas/documents";
import { GHG_STATEMENT_ENTITY_TYPE } from "@/lib/isometric/utils/constants";
import { ACTIVITY_ENTITY_TYPES, isActivityEntityType } from "@/db/schema/common";

it.each(ACTIVITY_ENTITY_TYPES)("accepts the canonical activity entity type %s", (value) => {
  expect(isActivityEntityType(value)).toBe(true);
  expect(toActivityEntityType(value)).toBe(value);
});

it.each([
  ["productionRun", "production_run"],
  ["biocharProduct", "biochar_product"],
  ["labSample", "lab_sample"],
  ["binMovement", "bin_movement"],
  [GHG_STATEMENT_ENTITY_TYPE, "ghg_statement"],
])("maps the alias %s to %s without accepting it for persistence", (alias, canonical) => {
  expect(isActivityEntityType(alias)).toBe(false);
  expect(toActivityEntityType(alias)).toBe(canonical);
});

it.each(["", "deliveries", "Delivery", " delivery", "unknown_entity", "output_stock_movement", "toString", "__proto__"])(
  "refuses unknown or normalized spellings: %s", (value) => {
    expect(isActivityEntityType(value)).toBe(false);
    expect(() => toActivityEntityType(value)).toThrow(`Unknown activity entity type: ${value}`);
  },
);

it.each(DOCUMENT_ENTITY_TYPES)("preserves the supported document owner %s", value => {
  expect(toActivityDocumentOwnerType(value)).toBe(value);
});

it.each([
  ["ghgStatement", "ghg_statement"],
  ["ghgStatementReport", "ghg_statement_report"],
  ["ghg_statement_report", "ghg_statement_report"],
  ["productionRun", "production_run"],
])("normalizes the document owner %s to %s", (value, canonical) => {
  expect(toActivityDocumentOwnerType(value)).toBe(canonical);
});

it("rejects unknown document owners instead of losing ownership to a fallback", () => {
  expect(() => toActivityDocumentOwnerType("unknown_owner")).toThrow("Unknown activity entity type: unknown_owner");
});

it("reads a document reason code back to its type and owner", () => {
  expect(parseDocumentActivityReasonCode("document:weighbridge_ticket:feedstock:feed-1"))
    .toEqual({ documentType: "weighbridge_ticket", ownerType: "feedstock", ownerId: "feed-1" });
  expect(parseDocumentActivityReasonCode("document:a:b:c:owner:id")).toEqual({ documentType: "a:b:c", ownerType: "owner", ownerId: "id" });
  for (const reason of [null, undefined, "detached", "document:owner:id"]) expect(parseDocumentActivityReasonCode(reason)).toBeNull();
});

it("maps document owners onto activity types where they have their own activity", () => {
  expect(documentOwnerActivityType("sample")).toBe("lab_sample");
  expect(documentOwnerActivityType("feedstock")).toBe("feedstock");
  expect(documentOwnerActivityType("reactor")).toBeNull();
});

it.each([
  ["sample", "lab_sample"],
  ["biochar", "biochar_product"],
  ["feedstock", "feedstock"],
  ["reactor", "reactor"],
  ["unknown_owner", "unknown_owner"],
])("maps the polymorphic owner %s to %s", (owner, activityType) => {
  expect(polymorphicOwnerActivityType(owner)).toBe(activityType);
});
