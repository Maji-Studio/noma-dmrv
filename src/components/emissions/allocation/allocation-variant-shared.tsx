/**
 * PROTOTYPE ONLY (allocation chart round): the pieces variants A, B and C
 * share. Every figure comes from the allocation model (`fractionFor`,
 * `percentFor`, `wholePercents`, `feedstockHint`) and a stream's `pick`.
 */
"use client";

import { CircleHalfIcon } from "@phosphor-icons/react/dist/ssr";
import { useState } from "react";
import { TextAction } from "@/components/ui/text-action";
import { cn } from "@/lib/utils";
import type { AllocationRecord } from "@/types/emission-allocation";
import type { Stream, StreamKey } from "./allocation-flow-graph";
import { formatNumber, recordLine, recordName } from "./allocation-format";
import { HintMarker } from "./allocation-hint";
import { allOwners, feedstockHint, fractionFor, percentFor, sharesOf, wholePercents, type Focus, type Owner } from "./allocation-model";
import { MUTED } from "./allocation-parts";

/** Rest state: the first rows, then "Show all N". */
export const LIST_REST = 3;
export const LIT_BG = "color-mix(in srgb, var(--acc-dist) 18%, var(--paper))";
export const QUIET_BORDER = "var(--clr-dark-purple-20)";
const ICON_PX = 14;

/** A quantity named in full, for a row or lane label. */
export const ROW_LABEL: Record<StreamKey, string> = {
  feedstock: "Feedstock transport",
  delivery: "Biochar delivery transport",
  diesel: "Diesel",
  electricity: "Electricity",
  manual: "Manual transport",
};

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

const NOUNS: Record<AllocationRecord["group"], [string, string]> = {
  feedstockTransport: ["delivery", "deliveries"],
  production: ["run", "runs"],
  deliveryTransport: ["delivery", "deliveries"],
  manual: ["entry", "entries"],
};

/** "38 deliveries", "4 records" when the groups mix; a single record by its name. */
export function groupLabel(records: AllocationRecord[]): string {
  return records.length === 1 ? recordName(records[0]) : countLabel(records);
}

/** "38 deliveries", "1 run", "4 records" when the groups mix. */
export function countLabel(records: AllocationRecord[]): string {
  const groups = new Set(records.map((record) => record.group));
  const [one, many] = groups.size === 1 ? NOUNS[records[0].group] : ["record", "records"];
  return `${records.length} ${records.length === 1 ? one : many}`;
}

/** Hinted rows first (partly used, counted on), then split rows, then by date. */
export function sortForList(records: AllocationRecord[], focus: Focus, codes: ReadonlyMap<string, string>): AllocationRecord[] {
  const owners = allOwners(focus);
  const rank = (record: AllocationRecord) => (feedstockHint(record, focus.owner, focus.owners, codes) ? 0 : sharesOf(record, owners).length > 1 ? 1 : 2);
  return [...records].sort((a, b) => rank(a) - rank(b) || a.date.localeCompare(b.date) || a.code.localeCompare(b.code));
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

export function HintSummary({ records, focus, codes, className }: { records: AllocationRecord[]; focus: Focus; codes: ReadonlyMap<string, string>; className?: string }) {
  const phrases = hintPhrases(records, focus, codes);
  if (!phrases.length) return null;
  return (
    <span className={cn("inline-flex items-center gap-4 body-caption text-[var(--color-text-primary)]", className)}>
      <CircleHalfIcon size={ICON_PX} aria-hidden className="shrink-0 text-[var(--clr-dark-purple-60)]" />
      {phrases.join(", ")}
    </span>
  );
}

/**
 * The records behind a selection, one row each. With `owner`, the share that
 * owner carries ("Share"); without, where each record goes ("Goes to"). The
 * first three rows, then "Show all N".
 */
export function RecordList({ records, stream, focus, codes, owner }: {
  records: AllocationRecord[];
  stream: Stream;
  focus: Focus;
  codes: ReadonlyMap<string, string>;
  owner?: Owner;
}) {
  const [showAll, setShowAll] = useState(false);
  const owners = allOwners(focus);
  const viewer = owner ?? focus.owner;
  const rows = sortForList(records, { ...focus, owner: viewer }, codes);
  const shown = showAll ? rows : rows.slice(0, LIST_REST);
  const valueOf = (record: AllocationRecord) => (stream.pick(record) ?? 0) * (owner ? fractionFor(record, owner) : 1);
  const total = rows.reduce((sum, record) => sum + valueOf(record), 0);
  return (
    <div className="flex min-w-0 flex-col gap-4" aria-live="polite">
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-left">
            <th scope="col" className={cn("py-6 pr-12 body-small font-medium", MUTED)}>Record</th>
            <th scope="col" className={cn("w-[96px] py-6 pr-12 text-right body-small font-medium sm:w-[160px]", MUTED)}>{owner ? "Share" : "Goes to"}</th>
            <th scope="col" className={cn("w-[64px] py-6 text-right body-small font-medium sm:w-[112px]", MUTED)}>{stream.unit}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((record) => {
            const hint = feedstockHint(record, viewer, focus.owners, codes);
            return (
              <tr key={record.id} className="[border-top:var(--row-divider)] align-top">
                <th scope="row" className="py-6 pr-12 text-left font-normal">
                  <span className="block body-small">{recordName(record)}</span>
                  <span className={cn("block body-caption", MUTED)}>{recordLine(record)}</span>
                  {hint && <HintMarker hint={hint} viewer={viewer} className="pt-2" />}
                </th>
                <td className="py-6 pr-12 text-right align-top body-small tabular-nums">
                  {owner ? (
                    <>
                      {percentFor(record, owner, owners)}%
                      {hint?.kind === "countedOn" && (
                        <span className={cn("block whitespace-nowrap body-caption", MUTED)}>
                          Counted on <span className="font-mono text-[var(--color-text-primary)]">{hint.ownerLabel}</span>
                        </span>
                      )}
                    </>
                  ) : (
                    sharesOf(record, owners).map((share) => (
                      <span key={share.owner.key} className={cn("flex flex-wrap justify-end gap-x-4", share.owner.key === focus.owner.key ? "font-medium" : MUTED)}>
                        <span className="whitespace-nowrap">{share.percent}%</span>
                        <span className={cn("whitespace-nowrap", !share.owner.notYet && "font-mono")}>{share.owner.notYet ? "not yet allocated" : share.owner.label}</span>
                      </span>
                    ))
                  )}
                </td>
                <td className="py-6 text-right body-small tabular-nums">{formatNumber(valueOf(record))}</td>
              </tr>
            );
          })}
        </tbody>
        {rows.length > 1 && <tfoot>
          <tr className="[border-top:var(--hair-2)]">
            <th scope="row" className="py-6 pr-12 text-left body-small font-medium">Total</th>
            <td />
            <td className="py-6 text-right body-small font-medium tabular-nums">{formatNumber(total)}</td>
          </tr>
        </tfoot>}
      </table>
      {!showAll && rows.length > LIST_REST && <TextAction onClick={() => setShowAll(true)}>Show all {rows.length}</TextAction>}
    </div>
  );
}
