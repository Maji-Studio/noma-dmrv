import { describe, expect, it } from "vitest";
import { linkedRecordReadOnlyReason } from "./linked-record-read-only";

const ARCHIVED = { ready: true, readOnly: { reason: "archived" as const, facilityId: "facility-x", facilityName: "Mafinga" } };
const UNCHECKED = { ready: true, readOnly: { reason: "unchecked" as const, facilityId: "facility-x" } };

describe("linkedRecordReadOnlyReason", () => {
  it("names the archived facility and says the record is read-only", () => {
    expect(linkedRecordReadOnlyReason(ARCHIVED, { facilityId: "facility-x" }, "order"))
      .toBe("Mafinga is archived, so this order is read-only.");
  });

  it("fails closed when the facility could not be checked, with the next step", () => {
    expect(linkedRecordReadOnlyReason(UNCHECKED, { facilityId: "facility-x" }, "order"))
      .toBe("This order's facility could not be checked, so it is read-only. Refresh the page to try again.");
  });

  it("gives a record in another facility nothing", () => {
    expect(linkedRecordReadOnlyReason(ARCHIVED, { facilityId: "facility-a" }, "order")).toBeUndefined();
    expect(linkedRecordReadOnlyReason(UNCHECKED, { facilityId: "facility-a" }, "order")).toBeUndefined();
    expect(linkedRecordReadOnlyReason(ARCHIVED, null, "order")).toBeUndefined();
  });

  it("gives nothing while the linked facility is workable", () => {
    expect(linkedRecordReadOnlyReason({ ready: true, readOnly: null }, { facilityId: "facility-x" }, "order")).toBeUndefined();
  });
});
