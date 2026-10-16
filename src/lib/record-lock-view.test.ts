import { describe, expect, it } from "vitest";
import { isBinFormulationLocked, isRecordDeletable, isRecordEditable, isRecordFieldLocked, recordLockSaveBlockedReason, type RecordLockView } from "./record-lock-view";

const lock = (level: RecordLockView["level"]): RecordLockView => ({
  level, heldBy: [], usedBy: [], freeFields: level === "sent" ? [] : ["code", "quantityKg"], howToFree: null, returnedBy: [],
});

describe("record lock view helpers", () => {
  it("locks nothing while Open or while the read has not answered", () => {
    expect(isRecordFieldLocked(lock("open"), "customerId")).toBe(false);
    expect(isRecordFieldLocked(undefined, "customerId")).toBe(false);
  });

  it("locks only the fields outside freeFields while In use", () => {
    expect(isRecordFieldLocked(lock("inUse"), "quantityKg")).toBe(false);
    expect(isRecordFieldLocked(lock("inUse"), "customerId")).toBe(true);
  });

  it("locks every field once Sent", () => {
    expect(isRecordFieldLocked(lock("sent"), "quantityKg")).toBe(true);
  });

  it("offers Edit until Sent and Delete only while Open, and neither before the lock answers", () => {
    expect([lock("open"), lock("inUse"), lock("sent")].map(isRecordEditable)).toEqual([true, true, false]);
    expect([lock("open"), lock("inUse"), lock("sent")].map(isRecordDeletable)).toEqual([true, false, false]);
    expect(isRecordEditable(undefined)).toBe(false);
    expect(isRecordDeletable(undefined)).toBe(false);
  });

  it("turns Save off until the lock answers, when it fails, and once Sent", () => {
    expect(recordLockSaveBlockedReason(undefined, "pending")).toBe("Checking whether this record can change.");
    expect(recordLockSaveBlockedReason(undefined, "error")).toBe("Couldn't check whether this record can change. Refresh the page and try again.");
    expect(recordLockSaveBlockedReason(lock("sent"), "ready")).toBe("This record was sent with its Removal, so it cannot be saved.");
    expect(recordLockSaveBlockedReason(lock("inUse"), "ready")).toBeNull();
  });

  describe("product bin formulation (updateStorageLocation's guard)", () => {
    const bin = (stored: (string | null)[]) => ({ ...lock("inUse"), productFormulationIds: stored });
    it("is free while the bin stores no product", () => {
      expect(isBinFormulationLocked(bin([]), "f-1")).toBe(false);
      expect(isBinFormulationLocked(undefined, null)).toBe(false);
    });
    it("is fixed when the stored products already match the bin", () => {
      expect(isBinFormulationLocked(bin(["f-1"]), "f-1")).toBe(true);
      expect(isBinFormulationLocked(bin([null]), null)).toBe(true);
    });
    it("is fixed when the bin stores products of more than one formulation", () => {
      expect(isBinFormulationLocked(bin(["f-1", null]), null)).toBe(true);
    });
    it("stays open only for the one formulation every stored product has", () => {
      expect(isBinFormulationLocked(bin(["f-1"]), null)).toBe(false);
    });
  });
});
