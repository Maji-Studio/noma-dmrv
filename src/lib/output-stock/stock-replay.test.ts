import { describe, expect, it } from "vitest";
import type { OutputStockHistoryEntry } from "@/types/output-stock";
import { decimal } from './exact';
import { estimateStock, postingWetSteps, type LayerMoistureBasis } from './moisture-estimate';
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

it('replays the saved re-estimate delta to the same stock as the live estimate', () => {
  const live = estimateStock([{ layerId: 'b1', placedAt: AT(9), remainingSolidsKg: decimal('55'),
    recorded: { solidsKg: decimal('80'), wetKg: decimal('100') }, readings: [],
    removals: [{ wetKg: decimal('50'), solidsKg: decimal('55'), moisturePercent: 50, occurredAt: AT(10), kind: 'loss', sequence: BigInt(1) }] }], AT(11));
  // getOutputStockHistory uses the current model's after minus before,
  // including the re-estimate, rather than negating the physical 50 kg lost.
  const loss = entry({ id: 'loss', kind: 'loss', occurredAt: AT(10), recordedAt: AT(10), wetMassKg: 50, moisturePercent: 50,
    dryMassKg: 25, wetDeltaKg: live.wetKg! - 100, solidsDeltaKg: -25, afterWetKg: live.wetKg, afterSolidsKg: 55 });
  expect(last([measured, loss])).toMatchObject({ wetKg: 110, solidsKg: 55, dryKg: 55 });
  const count = entry({ id: 'count', kind: 'count', occurredAt: AT(11), recordedAt: AT(11), dryMassKg: 10,
    wetDeltaKg: -50, solidsDeltaKg: -10, afterWetKg: 60, afterSolidsKg: 45 });
  expect(last([measured, loss, count])).toMatchObject({ wetKg: 60, solidsKg: 45, dryKg: 45 });
});

it('uses recomputed wet changes despite stale frozen preview balances', () => {
  const lateRun = entry({ id: 'late', kind: 'intake', occurredAt: AT(10), recordedAt: AT(15),
    dryMassKg: -80, wetDeltaKg: 200, solidsDeltaKg: 80 });
  const loss = entry({ id: 'loss', kind: 'loss', occurredAt: AT(11), recordedAt: AT(11),
    dryMassKg: 25, wetDeltaKg: -50, savedWetDeltaKg: 10, solidsDeltaKg: -25,
    afterWetKg: 110, afterSolidsKg: 55 });
  expect(last([loss, lateRun, measured])).toMatchObject({ wetKg: 250, solidsKg: 135, dryKg: 135 });
});

it('keeps counted wet unknown after a late intake makes the posting balance stale', () => {
  const bases: LayerMoistureBasis[] = [
    { layerId: 'legacy', placedAt: AT(9), remainingSolidsKg: decimal('80'), recorded: null, removals: [],
      readings: [{ moisturePercent: 20, solidsKg: decimal('80'), occurredAt: AT(12), sequence: BigInt(1) }] },
    { layerId: 'late', placedAt: AT(10), remainingSolidsKg: decimal('80'),
      recorded: { wetKg: decimal('200'), solidsKg: decimal('80') }, readings: [], removals: [] },
  ];
  const change = postingWetSteps(bases, [{ id: 'count', occurredAt: AT(12), sequence: BigInt(1) }]).get('count')!;
  expect(change).toEqual({ deltaKg: null, afterKg: 300 });
  const history = [
    entry({ id: 'legacy', kind: 'intake', dryMassKg: -80, solidsDeltaKg: 80, wetDeltaKg: null }),
    entry({ id: 'late', kind: 'intake', occurredAt: AT(10), recordedAt: AT(15), dryMassKg: -80, solidsDeltaKg: 80, wetDeltaKg: 200 }),
    entry({ id: 'count', kind: 'count', occurredAt: AT(12), recordedAt: AT(12), solidsDeltaKg: 0,
      wetDeltaKg: change.deltaKg, currentAfterWetKg: change.afterKg, afterWetKg: 100 }),
  ];
  // The posting balance is known, but cannot safely rebase physical-order history.
  expect(estimateStock(bases, AT(16)).wetKg).toBe(300);
  expect(last(history)?.wetKg).toBeNull();
  // Once recorded after the intake, the count can safely recover current wet.
  expect(last(history.map(row => row.kind === 'count' ? { ...row, recordedAt: AT(16) } : row))?.wetKg).toBe(300);
});

it('counts a loss from a later-placed layer in both history and balance', () => {
  const placedAt = '2026-09-16T12:00:00.000Z';
  const occurredAt = '2026-09-15T12:00:00.000Z';
  const bases: LayerMoistureBasis[] = [{ layerId: 'later', placedAt, remainingSolidsKg: decimal('64'),
    recorded: { wetKg: decimal('100'), solidsKg: decimal('80') }, readings: [],
    removals: [{ wetKg: decimal('20'), solidsKg: decimal('64'), sequence: BigInt(1), occurredAt, kind: 'loss', stockMode: 'split' }] }];
  const change = postingWetSteps(bases, [{ id: 'loss', occurredAt, sequence: BigInt(1) }]).get('loss')!;
  expect(change).toEqual({ deltaKg: -20, afterKg: 80 });
  const history = [
    entry({ ...measured, id: 'later', occurredAt: placedAt, recordedAt: placedAt }),
    entry({ id: 'loss', kind: 'loss', occurredAt, recordedAt: AT(9), dryMassKg: 16, solidsDeltaKg: -16,
      wetDeltaKg: change.deltaKg, currentAfterWetKg: change.afterKg }),
  ];
  expect(last(history)?.wetKg).toBe(80);
  expect(last(history)?.wetKg).toBe(estimateStock(bases, AT(16)).wetKg);
});

it.each(['mix', 'split'] as const)('keeps wet unknown after a %s loss posted after an earlier-recorded count', (stockMode) => {
  const bases: LayerMoistureBasis[] = [{ layerId: 'legacy', placedAt: AT(9), remainingSolidsKg: decimal('64'),
    recorded: null,
    readings: [{ moisturePercent: 20, solidsKg: decimal('80'), occurredAt: AT(12), sequence: BigInt(1) }],
    removals: [{ wetKg: decimal('20'), solidsKg: decimal('64'), moisturePercent: 20,
      occurredAt: AT(11), sequence: BigInt(2), kind: 'loss', stockMode }] }];
  const changes = postingWetSteps(bases, [
    { id: 'count', occurredAt: AT(12), sequence: BigInt(1) },
    { id: 'loss', occurredAt: AT(11), sequence: BigInt(2) },
  ]);
  expect(changes.get('count')).toEqual({ deltaKg: null, afterKg: 100 });
  expect(changes.get('loss')).toEqual({ deltaKg: -20, afterKg: 80 });
  expect(estimateStock(bases, AT(16)).wetKg).toBe(80);
  const history = [
    entry({ id: 'legacy', kind: 'intake', dryMassKg: -80, solidsDeltaKg: 80, wetDeltaKg: null }),
    entry({ id: 'count', kind: 'count', occurredAt: AT(12), recordedAt: AT(12), solidsDeltaKg: 0,
      wetDeltaKg: changes.get('count')!.deltaKg, currentAfterWetKg: changes.get('count')!.afterKg, afterWetKg: 100 }),
    entry({ id: 'loss', kind: 'loss', occurredAt: AT(11), recordedAt: AT(15), dryMassKg: 16, solidsDeltaKg: -16,
      wetDeltaKg: changes.get('loss')!.deltaKg, currentAfterWetKg: changes.get('loss')!.afterKg, afterWetKg: 80 }),
  ];
  expect(last(history)).toMatchObject({ dryKg: 64, solidsKg: 64, wetKg: null });
});
