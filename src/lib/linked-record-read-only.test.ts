import { describe, expect, it, vi } from "vitest";
import { linkedRecordReadOnly } from "./linked-record-read-only";

const ARCHIVED = { ready: true, readOnly: { reason: "archived" as const, facilityId: "facility-x", facilityName: "Mafinga" } };
const retry = vi.fn();
const UNCHECKED = { ready: true, readOnly: { reason: "unchecked" as const, facilityId: "facility-x", retry, retrying: false } };

describe("linkedRecordReadOnly", () => {
  it("names the archived facility as information", () => {
    expect(linkedRecordReadOnly(ARCHIVED, { facilityId: "facility-x" }, "order"))
      .toEqual({ tone: "info", message: "Mafinga is archived, so this order is read-only." });
  });

  it("fails closed as a warning with a retry on the facility read", () => {
    expect(linkedRecordReadOnly(UNCHECKED, { facilityId: "facility-x" }, "order")).toEqual({
      tone: "warning",
      message: "This order's facility could not be checked, so it is read-only.",
      retry: { run: retry, running: false },
    });
  });

  it("gives a record in another facility nothing", () => {
    expect(linkedRecordReadOnly(ARCHIVED, { facilityId: "facility-a" }, "order")).toBeUndefined();
    expect(linkedRecordReadOnly(UNCHECKED, { facilityId: "facility-a" }, "order")).toBeUndefined();
    expect(linkedRecordReadOnly(ARCHIVED, null, "order")).toBeUndefined();
  });

  it("gives nothing while the linked facility is workable", () => {
    expect(linkedRecordReadOnly({ ready: true, readOnly: null }, { facilityId: "facility-x" }, "order")).toBeUndefined();
  });
});
