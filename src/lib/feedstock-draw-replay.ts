import { SafeError } from '@/lib/errors';
import type { OutputDrawOrder, OutputStockMode } from '@/lib/output-stock/stock-mode';

export const MASS_PRECISION_FACTOR = 1_000;
export interface FeedstockDrawMethod { stockMode: OutputStockMode; drawOrder: OutputDrawOrder }
export interface FeedstockMethodChange extends FeedstockDrawMethod {
  id: string;
  effectiveAt: string;
  createdAt: string;
  previousStockMode: OutputStockMode;
  previousDrawOrder: OutputDrawOrder;
}
export interface FeedstockDrawShare { feedstockId: string; wetKg: number }
export interface FeedstockReplayEvent {
  id: string;
  occurredAt: string;
  recordedAt: string;
  kind: 'intake' | 'run_draw' | 'ingredient_draw' | 'loss' | 'count';
  wetDeltaKg: number | null;
  sourceId?: string | null;
  code?: string | null;
  reversed?: boolean;
  /** Present only for runs before the replanning boundary. An empty array is authoritative. */
  savedShares?: readonly FeedstockDrawShare[];
  /** An explicitly saved cancelled run records provenance without consuming stock. */
  historyOnly?: boolean;
}
export class FeedstockReplayOverdrawError extends SafeError {
  constructor(readonly event: FeedstockReplayEvent, readonly availableWetKg: number, readonly requestedWetKg: number) {
    super('The bin held less wet mass than the run drew.');
  }
}
export function feedstockMethodAt(current: FeedstockDrawMethod, changes: readonly FeedstockMethodChange[], at: string): FeedstockDrawMethod {
  const ordered = [...changes].sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  if (!ordered.length) return current;
  const change = ordered.filter(row => row.effectiveAt <= at).at(-1);
  return change ? { stockMode: change.stockMode, drawOrder: change.drawOrder } : { stockMode: ordered[0].previousStockMode, drawOrder: ordered[0].previousDrawOrder };
}
export function compareFeedstockEvents(a: FeedstockReplayEvent, b: FeedstockReplayEvent): number {
  return a.occurredAt.localeCompare(b.occurredAt) || a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id);
}
function grams(kg: number): bigint {
  const units = Math.round(kg * MASS_PRECISION_FACTOR);
  if (!Number.isSafeInteger(units)) throw new SafeError('Feedstock mass is too large to allocate safely');
  return BigInt(units);
}
const kg = (units: bigint) => Number(units) / MASS_PRECISION_FACTOR;
const minimum = (a: bigint, b: bigint) => a < b ? a : b;

/** Largest remainder in delivery order. BigInt keeps products exact at numeric(14,3). */
function proportional(amount: bigint, holdings: readonly { id: string; units: bigint }[]): Map<string, bigint> {
  const total = holdings.reduce((sum, row) => sum + row.units, BigInt(0));
  if (!total) return new Map();
  const shares = holdings.map((row, index) => ({ id: row.id, index, units: amount * row.units / total, remainder: amount * row.units % total }));
  let left = amount - shares.reduce((sum, row) => sum + row.units, BigInt(0));
  for (const row of [...shares].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1)) {
    if (!left) break;
    row.units += BigInt(1);
    left -= BigInt(1);
  }
  return new Map(shares.map(row => [row.id, row.units]));
}

export function drawShares(amount: bigint, present: { id: string; units: bigint }[], method: FeedstockDrawMethod): Map<string, bigint> {
  if (method.stockMode === 'mix') return proportional(amount, present);
  const shares = new Map<string, bigint>();
  let left = amount;
  for (const row of method.drawOrder === 'newest_first' ? [...present].reverse() : present) {
    const taken = minimum(left, row.units);
    if (taken > 0) shares.set(row.id, taken);
    left -= taken;
  }
  return shares;
}

/** One wet-stock ledger, shared by planning and read models. Validate withdrawals from the edit boundary. */
export function replayFeedstockDraws(events: readonly FeedstockReplayEvent[], current: FeedstockDrawMethod,
  changes: readonly FeedstockMethodChange[] = [], boundary?: { occurredAt: string; recordedAt?: string; id?: string; exclusive?: boolean }) {
  const holdings = new Map<string, bigint>();
  const withdrawals = new Map<string, FeedstockDrawShare[]>();
  const points = new Map<string, Map<string, number>>();
  // A negative balance is unpaid historical withdrawal debt. Additions repay it first.
  let unattributed = BigInt(0);
  const wetTotals = new Map<string, number>();
  for (const event of [...events].sort(compareFeedstockEvents)) {
    if (event.reversed) {
      points.set(event.id, new Map([...holdings].map(([id, units]) => [id, kg(units)])));
      wetTotals.set(event.id, kg([...holdings.values()].reduce((sum, units) => sum + units, unattributed)));
      continue;
    }
    const delta = grams(event.wetDeltaKg ?? 0);
    const repaid = delta > 0 && unattributed < 0 ? minimum(delta, -unattributed) : BigInt(0);
    unattributed += repaid;
    const addition = delta - repaid;
    if (event.kind === 'intake' && delta > 0) {
      holdings.set(event.id, (holdings.get(event.id) ?? BigInt(0)) + addition);
    }
    else if (delta > 0) {
      const gains = proportional(addition, [...holdings].filter(([, units]) => units > 0).map(([id, units]) => ({ id, units })));
      if (!gains.size) unattributed += addition;
      for (const [id, units] of gains) holdings.set(id, holdings.get(id)! + units);
      if (event.kind === 'count') withdrawals.set(event.id, [...gains].map(([feedstockId, units]) => ({ feedstockId, wetKg: -kg(units) })));
    } else if (delta < 0) {
      const present = [...holdings].filter(([, units]) => units > 0).map(([id, units]) => ({ id, units }));
      const total = present.reduce((sum, row) => sum + row.units, BigInt(0));
      const requested = -delta;
      const affected = boundary !== undefined && (event.occurredAt > boundary.occurredAt ||
        (event.occurredAt === boundary.occurredAt && (!boundary.recordedAt || event.recordedAt > boundary.recordedAt ||
          (event.recordedAt === boundary.recordedAt && (!boundary.id || (boundary.exclusive ? event.id > boundary.id : event.id >= boundary.id))))));
      if (((event.kind === 'run_draw' && event.savedShares === undefined) || (event.kind !== 'run_draw' && affected)) && requested > total + unattributed)
        throw new FeedstockReplayOverdrawError(event, kg(total + unattributed), kg(requested));
      const amount = minimum(requested, total);
      let shares: Map<string, bigint>;
      if (event.savedShares !== undefined) {
        shares = new Map(event.savedShares.filter(row => row.wetKg > 0).map(row => [row.feedstockId, grams(row.wetKg)]));
      } else {
        shares = drawShares(amount, present, feedstockMethodAt(current, changes, event.occurredAt));
      }
      if (event.historyOnly) {
        withdrawals.set(event.id, [...shares].filter(([, units]) => units > 0).map(([feedstockId, units]) => ({ feedstockId, wetKg: kg(units) })));
        points.set(event.id, new Map([...holdings].map(([id, units]) => [id, kg(units)])));
        wetTotals.set(event.id, kg(total + unattributed));
        continue;
      }
      let deficit = requested;
      for (const [id, units] of shares) {
        // Saved provenance is immutable; only available physical mass is charged.
        const taken = minimum(minimum(holdings.get(id) ?? BigInt(0), units), deficit);
        if (holdings.has(id)) holdings.set(id, holdings.get(id)! - taken);
        deficit -= taken;
      }
      const remainingHoldings = [...holdings].filter(([, units]) => units > 0).map(([id, units]) => ({ id, units }));
      const remainingTotal = remainingHoldings.reduce((sum, row) => sum + row.units, BigInt(0));
      for (const [id, units] of drawShares(minimum(deficit, remainingTotal), remainingHoldings, feedstockMethodAt(current, changes, event.occurredAt))) {
        holdings.set(id, holdings.get(id)! - units);
        deficit -= units;
      }
      unattributed -= deficit;
      withdrawals.set(event.id, [...shares].filter(([, units]) => units > 0).map(([feedstockId, units]) => ({ feedstockId, wetKg: kg(units) })));
    }
    points.set(event.id, new Map([...holdings].map(([id, units]) => [id, kg(units)])));
    wetTotals.set(event.id, kg([...holdings.values()].reduce((sum, units) => sum + units, unattributed)));
  }
  return { withdrawals, remaining: new Map([...holdings].map(([id, units]) => [id, kg(units)])), unattributedWetKg: kg(unattributed), points, wetTotals };
}
