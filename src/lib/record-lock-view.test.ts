import { describe, expect, it } from "vitest";
import { isBinFormulationLocked, isProductionRunOutputLocked, isRecordDeletable, isRecordEditable, isRecordFieldHeld, isRecordFieldLocked, recordLockSaveBlock, type RecordLockView } from "./record-lock-view";

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

  it("turns Save off until the lock answers and when it fails, and makes a Sent form read-only", () => {
    expect(recordLockSaveBlock(undefined, "pending")).toEqual({ reason: "Checking whether this record can change.", tone: "info", readOnly: false });
    expect(recordLockSaveBlock(undefined, "error")).toEqual({ reason: "Couldn't check whether this record can change. Try again.", tone: "error", readOnly: false });
    expect(recordLockSaveBlock(lock("sent"), "ready")).toEqual({ reason: "This record was sent with its Removal, so it cannot be saved.", tone: "error", readOnly: true });
    expect(recordLockSaveBlock(lock("inUse"), "ready")).toBeNull();
  });

  it("keeps the fields an In use record holds closed until the lock answers", () => {
    const free = ["code", "quantityKg"];
    expect(isRecordFieldHeld(undefined, free, "customerId")).toBe(true);
    expect(isRecordFieldHeld(undefined, free, "quantityKg")).toBe(false);
    expect(isRecordFieldHeld(lock("open"), free, "customerId")).toBe(false);
    expect(isRecordFieldHeld(lock("sent"), free, "quantityKg")).toBe(true);
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

describe("production run output basis (assertProductionRunOutputBasisChange)", () => {
  const run = (level: RecordLockView["level"], kinds: string[]): RecordLockView => ({
    ...lock(level), usedBy: kinds.map((kind, index) => ({ kind, id: `${kind}-${index}`, label: null, facilityId: null })),
  });
  it("is fixed once a product, a stock entry or a count uses the run, and once Sent", () => {
    expect(isProductionRunOutputLocked(run("inUse", ["biocharProduct"]))).toBe(true);
    expect(isProductionRunOutputLocked(run("inUse", ["stockEntry"]))).toBe(true);
    expect(isProductionRunOutputLocked(run("inUse", ["delivery"]))).toBe(true);
    expect(isProductionRunOutputLocked(run("sent", []))).toBe(true);
  });
  it("stays free when only a credit batch uses the run, while Open, or before the lock answers", () => {
    expect(isProductionRunOutputLocked(run("inUse", ["creditBatch"]))).toBe(false);
    expect(isProductionRunOutputLocked(run("open", []))).toBe(false);
    expect(isProductionRunOutputLocked(undefined)).toBe(false);
  });
});
