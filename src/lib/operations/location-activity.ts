import type { CaptureFilledDelivery } from "@/data-access/location-distance-fill";
import { resolveWriteActivityScopes } from "@/data-access/write-activity";
import type { OperationScope } from "./runner";

export function recordFilledDeliveryActivity({ ctx, tx, activity }: OperationScope): CaptureFilledDelivery {
  return async (before, after) => {
    activity.capture(after.id, before, after);
    activity.link({ facilityId: after.facilityId }, after.id);
    activity.scope(after.id, await resolveWriteActivityScopes(ctx, tx, "delivery", after.id));
    activity.extra({
      outcome: "updated", entityType: "delivery", entityIds: [after.id],
      versionBefore: before.version, versionAfter: after.version,
    });
  };
}
