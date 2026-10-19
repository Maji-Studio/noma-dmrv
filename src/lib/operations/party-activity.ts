import type { CaptureActivity } from "@/lib/activity-changes";
import type { OperationScope } from "./runner";

/** Capture each persisted child transition before queuing its event. */
export function recordPartyLocationActivity(
  { activity }: OperationScope,
  kind: "supplier" | "customer",
): CaptureActivity {
  return (id, before, after) => {
    activity.capture(id, before, after);
    activity.extra({
      outcome: after === null ? "deleted" : before === null ? "created" : "updated",
      entityType: `${kind}_location`, entityIds: [id],
      versionBefore: before === null ? null : Number(before.version),
      versionAfter: after === null ? null : Number(after.version),
    });
  };
}
