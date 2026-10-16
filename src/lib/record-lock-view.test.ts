import { describe, expect, it } from "vitest";
import { isRecordDeletable, isRecordEditable, isRecordFieldLocked, type RecordLockView } from "./record-lock-view";

const lock = (level: RecordLockView["level"]): RecordLockView => ({
  level, heldBy: [], usedBy: [], freeFields: level === "sent" ? [] : ["code", "quantityKg"], howToFree: null,
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

  it("offers Edit until Sent and Delete only while Open", () => {
    expect([lock("open"), lock("inUse"), lock("sent")].map(isRecordEditable)).toEqual([true, true, false]);
    expect([lock("open"), lock("inUse"), lock("sent")].map(isRecordDeletable)).toEqual([true, false, false]);
    expect(isRecordDeletable(undefined)).toBe(true);
  });
});
