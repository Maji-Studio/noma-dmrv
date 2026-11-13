/**
 * The Allocation Flow view's numbers, pure: for one quantity, who carries how
 * much of it. Every figure comes from the allocation model (`fractionFor`,
 * `wholePercents`, `feedstockHint`) and a stream's `pick`, so a record's
 * parts always add to the record and never exceed it. Owners are the page's
 * credit batches on a batch page, Removals on a Removal sheet.
 */
import type { AllocationRecord } from "@/types/emission-allocation";
import { allOwners, feedstockHint, fractionFor, wholePercents, type Focus, type Owner } from "./allocation-model";
import type { Stream } from "./allocation-streams";

export interface Slice {
  owner: Owner;
  value: number;
  percent: number;
}

export interface StreamSummary {
  stream: Stream;
  /** Records with a recorded figure above zero, with that figure. */
  items: { record: AllocationRecord; value: number }[];
  total: number;
  /** Owners with a positive part, in column order, Not yet allocated last. */
  slices: Slice[];
  mine: number;
  minePercent: number;
  /** Records in the stream with no recorded figure. */
  undrawn: number;
}

export function drawableItems(stream: Stream, records: AllocationRecord[]) {
  return records.flatMap((record) => {
    const value = stream.pick(record);
    return value !== null && value > 0 ? [{ record, value }] : [];
  });
}

export function streamSummary(stream: Stream, records: AllocationRecord[], focus: Focus): StreamSummary {
  const items = drawableItems(stream, records);
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const valued = allOwners(focus)
    .map((owner) => ({ owner, value: items.reduce((sum, item) => sum + item.value * fractionFor(item.record, owner), 0) }))
    .filter((slice) => slice.value > 0);
  const percents = total > 0 ? wholePercents(valued.map((slice) => slice.value / total)) : valued.map(() => 0);
  const slices = valued.map((slice, index) => ({ ...slice, percent: percents[index] }));
  const own = slices.find((slice) => slice.owner.key === focus.owner.key);
  const undrawn = records.filter((record) => stream.has(record) && stream.pick(record) === null).length;
  return { stream, items, total, slices, mine: own?.value ?? 0, minePercent: own?.percent ?? 0, undrawn };
}

/** Hint A summed over records for the page: "2 partly used", "1 counted on CB-26-002". */
export function hintPhrases(records: AllocationRecord[], focus: Focus, codes: ReadonlyMap<string, string>): string[] {
  let partly = 0;
  const countedOn = new Map<string, number>();
  for (const record of records) {
    const hint = feedstockHint(record, focus.owner, focus.owners, codes);
    if (hint?.kind === "partly") partly += 1;
    if (hint?.kind === "countedOn") countedOn.set(hint.ownerLabel, (countedOn.get(hint.ownerLabel) ?? 0) + 1);
  }
  return [...(partly ? [`${partly} partly used`] : []), ...[...countedOn.entries()].map(([label, count]) => `${count} counted on ${label}`)];
}
