import { expect, it, vi } from "vitest";
import { certifierRemovals } from "@/db/schema";

// Reads each selected column as the row's value: the code column answers "RM-26-001", anything else a short id.
vi.mock("@/db", () => ({
  db: {
    select: (fields: { label: unknown }) => ({
      from: () => ({ where: async () => [{ id: "11111111-1111-1111-1111-111111111111", label: fields.label === certifierRemovals.code ? "RM-26-001" : "70439de2", facilityId: null }] }),
    }),
  },
}));

import { activityChangeLabels, resolveActivityRecords } from "./activity-record-labels";
it("keeps future entity types readable without asserting they were deleted", async () => {
  const labels = await resolveActivityRecords({ organizationId: "org", userId: "user", orgRole: "admin", isPlatformAdmin: false }, [
    { entityType: "future_record", entityId: "entry-1", action: "created" },
  ]);
  expect(labels.get("future_record:entry-1")).toEqual({ label: "future record entry-1", deleted: false, facilityId: null, facilityTimezone: null });
});

it("resolves each polymorphic link side to its activity entity type", () => {
  const changes = { entityType: { from: "sample", to: "biochar" }, entityId: { from: "sample-id", to: "product-id" } };
  const records = new Map([
    ["lab_sample:sample-id", { label: "LS-1", deleted: false, facilityId: null, facilityTimezone: null }],
    ["biochar_product:product-id", { label: "BP-1", deleted: false, facilityId: null, facilityTimezone: null }],
  ]);
  expect(activityChangeLabels("transport_leg", changes, records)).toEqual({ entityId: {
    from: { label: "LS-1", deleted: false, type: "lab_sample" },
    to: { label: "BP-1", deleted: false, type: "biochar_product" },
  } });
  expect(activityChangeLabels("transport_leg", { entityId: changes.entityId }, records)).toEqual({ entityId: {
    from: { label: null, deleted: false, type: null }, to: { label: null, deleted: false, type: null },
  } });
});

it("labels a removal by its code, not a short id", async () => {
  const id = "11111111-1111-1111-1111-111111111111";
  const labels = await resolveActivityRecords({ organizationId: "org", userId: "user", orgRole: "admin", isPlatformAdmin: false }, [
    { entityType: "removal", entityId: id, action: "updated" },
  ]);
  expect(labels.get(`removal:${id}`)?.label).toBe("RM-26-001");
});
