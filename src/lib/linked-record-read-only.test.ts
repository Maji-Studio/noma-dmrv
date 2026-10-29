import { describe, expect, it } from "vitest";
import { archivedFacilityReadOnlyReason } from "./linked-record-read-only";

const ARCHIVED = { ready: true, archivedFacility: { id: "facility-x", name: "Mafinga" } };

describe("archivedFacilityReadOnlyReason", () => {
  it("names the archived facility and says the record is read-only", () => {
    expect(archivedFacilityReadOnlyReason(ARCHIVED, { facilityId: "facility-x" }, "order"))
      .toBe("Mafinga is archived, so this order is read-only.");
  });

  it("gives a record in another facility nothing", () => {
    expect(archivedFacilityReadOnlyReason(ARCHIVED, { facilityId: "facility-a" }, "order")).toBeUndefined();
    expect(archivedFacilityReadOnlyReason(ARCHIVED, null, "order")).toBeUndefined();
  });

  it("gives nothing while no linked facility is archived", () => {
    expect(archivedFacilityReadOnlyReason({ ready: true, archivedFacility: null }, { facilityId: "facility-x" }, "order")).toBeUndefined();
  });
});
