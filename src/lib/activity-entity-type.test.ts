import { expect, it } from "vitest";
import { toActivityEntityType } from "@/lib/activity-entity-type";
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
