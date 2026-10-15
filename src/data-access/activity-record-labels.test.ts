import { expect, it } from "vitest";
import { resolveActivityRecords } from "./activity-record-labels";
it("keeps future entity types readable without asserting they were deleted", async () => {
  const labels = await resolveActivityRecords({ organizationId: "org", userId: "user", orgRole: "owner", isPlatformAdmin: false }, [
    { entityType: "emission_entry", entityId: "entry-1" },
  ]);
  expect(labels.get("emission_entry:entry-1")).toEqual({ label: "emission entry entry-1", deleted: false });
});
