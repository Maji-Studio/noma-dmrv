import { describe, expect, it } from "vitest";
import { defaultNewBatchWindow, newBatchSlots, proposeWindow, slotsFor } from "./list-model";

describe("proposeWindow", () => {
  it("ends a gap window at the end of the month", () => {
    expect(proposeWindow("2026-02-14", "2026-03-10")).toEqual({ start: "2026-02-15", end: "2026-02-28" });
  });
  it("ends at the day before the next batch when that comes first", () => {
    expect(proposeWindow("2026-06-20", "2026-07-01")).toEqual({ start: "2026-06-21", end: "2026-06-30" });
    expect(proposeWindow("2026-03-01", "2026-03-10")).toEqual({ start: "2026-03-02", end: "2026-03-09" });
  });
  it("gives no window when no whole day is free", () => {
    expect(proposeWindow("2026-06-30", "2026-07-01")).toBeNull();
  });
  it("takes the rest of the month after the last batch", () => {
    expect(proposeWindow("2026-10-19", null)).toEqual({ start: "2026-10-20", end: "2026-10-31" });
  });
  it("takes the whole next month when the last batch ends on a month end", () => {
    expect(proposeWindow("2026-09-30", null)).toEqual({ start: "2026-10-01", end: "2026-10-31" });
    expect(proposeWindow("2026-12-31", null)).toEqual({ start: "2027-01-01", end: "2027-01-31" });
  });
});

describe("slotsFor", () => {
  it("chains windows until a gap is filled, then one tail slot", () => {
    const slots = slotsFor("Maize cobs", [
      { start: "2026-05-10", end: "2026-06-09" },
      { start: "2026-07-20", end: "2026-08-19" },
    ]);
    expect(slots.map((slot) => [slot.start, slot.end])).toEqual([
      ["2026-06-10", "2026-06-30"],
      ["2026-07-01", "2026-07-19"],
      ["2026-08-20", "2026-08-31"],
    ]);
  });
  it("covers the stub data's gaps", () => {
    const maize = newBatchSlots("Maize cobs");
    expect(maize.map((slot) => slot.start)).toEqual(expect.arrayContaining(["2026-02-15", "2026-03-01", "2026-07-01"]));
    expect(maize.at(-1)).toMatchObject({ start: "2026-10-20", end: "2026-10-31" });
    expect(newBatchSlots("Forestry waste").at(-1)).toMatchObject({ start: "2026-10-01", end: "2026-10-31" });
  });
});

describe("defaultNewBatchWindow", () => {
  it("is the current month when it is free", () => {
    expect(defaultNewBatchWindow([{ start: "2026-08-01", end: "2026-09-30" }], "2026-10-16")).toEqual({ start: "2026-10-01", end: "2026-10-31" });
  });
  it("skips a partly used month to the next free whole month", () => {
    expect(defaultNewBatchWindow([{ start: "2026-09-20", end: "2026-10-19" }], "2026-10-16")).toEqual({ start: "2026-11-01", end: "2026-11-30" });
  });
  it("skips several taken months", () => {
    const taken = [{ start: "2026-10-01", end: "2026-11-30" }];
    expect(defaultNewBatchWindow(taken, "2026-10-16")).toEqual({ start: "2026-12-01", end: "2026-12-31" });
  });
});
