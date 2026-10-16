import type { OperationScope } from "./runner";

const INITIAL_VERSION = 1;
/** Queue child effects for the runner to audit alongside the parent effect. */
export function recordPartyLocationActivity(
  { activity }: OperationScope,
  kind: "supplier" | "customer",
  action: "created" | "deleted",
  locations: { id: string; version: number }[],
): void {
  for (const location of locations) {
    activity.extra({
      outcome: action, entityType: `${kind}_location`, entityIds: [location.id],
      versionBefore: action === "created" ? null : location.version,
      versionAfter: action === "created" ? INITIAL_VERSION : null,
      changedFields: [],
    });
    if (action === "created" && location.version > INITIAL_VERSION) {
      activity.extra({
        outcome: "updated", entityType: `${kind}_location`, entityIds: [location.id],
        versionBefore: INITIAL_VERSION,
        versionAfter: location.version, changedFields: ["isDefault"],
      });
    }
  }
}
