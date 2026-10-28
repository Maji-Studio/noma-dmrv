import { RECORD_LINKS } from "@/lib/record-links";

export const ENTITY_DEEP_LINK_MODE_PARAM = "mode";
export const ENTITY_DEEP_LINK_FOCUS_PARAM = "focus";
export const ENTITY_DEEP_LINK_EDIT_MODE = "edit";
export const FEEDSTOCK_TYPE_EDIT_LABEL = "Edit feedstock type";
export const FEEDSTOCK_TYPE_QUERY_PARAM = RECORD_LINKS.feedstockType.param;
export const LOCATION_DEEP_LINK_PARAM = "location";
export const SUPPLIER_QUERY_PARAM = RECORD_LINKS.supplier.param;
export const VEHICLE_QUERY_PARAM = RECORD_LINKS.vehicle.param;
export const DRIVER_QUERY_PARAM = RECORD_LINKS.driver.param;
export const OPERATOR_QUERY_PARAM = RECORD_LINKS.operator.param;

export const ENTITY_FOCUS_TARGETS = {
  transportRoute: "transport-route",
  transportEvidence: "transport-evidence",
  removalTemplate: "removal-template",
} as const;

export type EntityFocusTarget =
  (typeof ENTITY_FOCUS_TARGETS)[keyof typeof ENTITY_FOCUS_TARGETS];

export function parseEntityFocusTarget(
  value: string | null | undefined,
): EntityFocusTarget | null {
  return Object.values(ENTITY_FOCUS_TARGETS).includes(
    value as EntityFocusTarget,
  )
    ? (value as EntityFocusTarget)
    : null;
}
