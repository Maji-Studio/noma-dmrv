import { describe, expect, it } from "vitest";
import type { OutputStockHistoryEntry } from "@/types/output-stock";
import { replayStock } from "./stock-replay";

const AT = (hour: number) => `2026-10-14T${String(hour).padStart(2, "0")}:00:00.000Z`;

function entry(values: Partial<OutputStockHistoryEntry> & Pick<OutputStockHistoryEntry, "id" | "kind">): OutputStockHistoryEntry {
  return { occurredAt: AT(9), recordedAt: AT(9), actorName: null, reason: "", wetMassKg: null, moisturePercent: 20, dryMassKg: 0,
    beforeDryKg: 0, afterDryKg: 0, correctsMovementId: null, deliveryId: null, allocations: [], ...values };
}

/** 100 kg wet at 20 % moisture: 80 kg dry biochar. */
const measured = entry({ id: "b1", kind: "intake", wetMassKg: 100, dryMassKg: -80, wetDeltaKg: 100, solidsDeltaKg: 80 });
/** An entry with no wet figure: 50 kg dry biochar. The database now refuses a run without moisture; the replay still handles any entry without a figure. */
const unmeasured = entry({ id: "b2", kind: "intake", occurredAt: AT(10), recordedAt: AT(10), moisturePercent: null, dryMassKg: -50, wetDeltaKg: null, solidsDeltaKg: 50 });

const last = (entries: OutputStockHistoryEntry[]) => replayStock(entries).at(-1)?.after;

describe("replayStock", () => {
  it("turns wet mass unknown from a batch added without a moisture reading", () => {
    const draw = entry({ id: "d1", kind: "delivery", occurredAt: AT(11), recordedAt: AT(11), dryMassKg: 20, wetDeltaKg: -25, solidsDeltaKg: -20 });
    expect(last([measured, unmeasured])).toMatchObject({ dryKg: 130, solidsKg: 130, wetKg: null });
    // A later draw still has no wet basis for what is left.
    expect(last([measured, unmeasured, draw])).toMatchObject({ dryKg: 110, wetKg: null });
  });

  it("knows wet mass again once the bin is emptied", () => {
    const emptied = entry({ id: "d1", kind: "delivery", occurredAt: AT(11), recordedAt: AT(11), dryMassKg: 130, wetDeltaKg: null, solidsDeltaKg: -130 });
    const refill = { ...measured, id: "b3", occurredAt: AT(12), recordedAt: AT(12) };
    const steps = replayStock([measured, unmeasured, emptied, refill]);
    expect(steps[2].after).toMatchObject({ dryKg: 0, solidsKg: 0, wetKg: 0 });
    expect(steps[3].after).toMatchObject({ dryKg: 80, solidsKg: 80, wetKg: 100 });
  });

  it("re-bases wet mass on a count's frozen balance after its reading", () => {
    // The count's preview had no wet figure before and 160 kg after: its frozen change is unknown.
    const count = entry({ id: "c1", kind: "count", occurredAt: AT(11), recordedAt: AT(11), dryMassKg: 0, wetDeltaKg: null, solidsDeltaKg: 0, afterWetKg: 160, afterSolidsKg: 130 });
    const draw = entry({ id: "d1", kind: "delivery", occurredAt: AT(12), recordedAt: AT(12), dryMassKg: 13, wetDeltaKg: -16, solidsDeltaKg: -13 });
    const steps = replayStock([measured, unmeasured, count, draw]);
    expect(steps[2].after).toMatchObject({ wetKg: 160, solidsKg: 130 });
    expect(steps[3].after).toMatchObject({ dryKg: 117, wetKg: 144 });
  });

  it("never re-bases on a frozen balance saved before a back-dated batch without a moisture reading", () => {
    // The delivery at 12:00 saw 100 kg wet before it and froze 75 kg after it.
    const draw = entry({ id: "d1", kind: "delivery", occurredAt: AT(12), recordedAt: AT(12), dryMassKg: 20, wetDeltaKg: -25, solidsDeltaKg: -20, afterWetKg: 75, afterSolidsKg: 60 });
    // Recorded at 14:00 but dated 11:00, before the delivery: its frozen balance never saw this batch.
    const backDated = { ...unmeasured, occurredAt: AT(11), recordedAt: AT(14) };
    expect(last([measured, draw])).toMatchObject({ dryKg: 60, wetKg: 75 });
    expect(last([measured, backDated, draw])).toMatchObject({ dryKg: 110, solidsKg: 110, wetKg: null });
  });

  it("never re-bases on a frozen balance saved before a run completed with an earlier end time", () => {
    // The delivery at 12:00 froze 75 kg wet after it.
    const draw = entry({ id: "d1", kind: "delivery", occurredAt: AT(12), recordedAt: AT(12), dryMassKg: 20, wetDeltaKg: -25, solidsDeltaKg: -20, afterWetKg: 75, afterSolidsKg: 60 });
    // Created at 08:00, completed at 16:00 with an 11:00 end and no moisture reading. The history dates a
    // run intake by its completion (getOutputStockHistory), so the delivery's balance never saw this run.
    const run = entry({ id: "run1", kind: "intake", occurredAt: AT(11), recordedAt: AT(16), moisturePercent: null, dryMassKg: -50, wetDeltaKg: null, solidsDeltaKg: 50 });
    expect(last([measured, run, draw])).toMatchObject({ dryKg: 110, solidsKg: 110, wetKg: null });
    // Dated by its creation instead, the run would let the stale 75 kg back in.
    expect(last([measured, { ...run, recordedAt: AT(8) }, draw])).toMatchObject({ wetKg: 75 });
  });

  it("still re-bases on a frozen balance saved after every earlier-dated entry", () => {
    const count = entry({ id: "c1", kind: "count", occurredAt: AT(12), recordedAt: AT(15), dryMassKg: 0, wetDeltaKg: null, solidsDeltaKg: 0, afterWetKg: 160, afterSolidsKg: 130 });
    const backDated = { ...unmeasured, occurredAt: AT(11), recordedAt: AT(14) };
    expect(last([measured, backDated, count])).toMatchObject({ wetKg: 160, solidsKg: 130 });
  });

  it("keeps the running wet mass over a frozen balance once it is known", () => {
    const count = entry({ id: "c1", kind: "count", occurredAt: AT(11), recordedAt: AT(11), dryMassKg: 0, wetDeltaKg: -10, solidsDeltaKg: 0, afterWetKg: 75 });
    expect(last([measured, count])?.wetKg).toBe(90);
  });

  it("never re-bases on a reversal, which carries its target's balance", () => {
    const reversal = entry({ id: "r1", kind: "reversal", correctsMovementId: "absent", occurredAt: AT(11), recordedAt: AT(11), dryMassKg: 0, wetDeltaKg: null, afterWetKg: 999 });
    expect(last([measured, unmeasured, reversal])?.wetKg).toBeNull();
  });

  it("skips cancelled pairs, mode changes and reading rows", () => {
    const loss = entry({ id: "l1", kind: "loss", occurredAt: AT(11), recordedAt: AT(11), dryMassKg: 8, wetDeltaKg: -10, solidsDeltaKg: -8 });
    const undo = entry({ id: "r1", kind: "reversal", correctsMovementId: "l1", occurredAt: AT(11), recordedAt: AT(12), dryMassKg: -8, wetDeltaKg: 10, solidsDeltaKg: 8 });
    const merge = entry({ id: "m1", kind: "merge", occurredAt: AT(12), recordedAt: AT(12), dryMassKg: 0 });
    const reading = entry({ id: "l1:moisture", kind: "moisture_update", occurredAt: AT(11), recordedAt: AT(11), wetDeltaKg: -10 });
    const steps = replayStock([measured, loss, undo, merge, reading]);
    expect(steps.map(step => [step.entry.id, step.live, step.moves])).toEqual([
      ["b1", true, true], ["l1", false, false], ["l1:moisture", true, false], ["r1", false, false], ["m1", true, false],
    ]);
    expect(steps.at(-1)?.after).toMatchObject({ dryKg: 80, wetKg: 100 });
  });
});
