/** The records behind one quantity's row, opened in place: the first three, then "Show all N". */
"use client";

import { useState } from "react";
import { TextAction } from "@/components/ui/text-action";
import { cn } from "@/lib/utils";
import type { AllocationRecord } from "@/types/emission-allocation";
import { formatNumber, recordLine, recordName } from "./allocation-format";
import { HintMarker } from "./allocation-hint";
import { NOT_YET_LABEL, allOwners, feedstockHint, sharesOf, type Focus } from "./allocation-model";
import { MUTED } from "./allocation-parts";
import type { Stream } from "./allocation-streams";

/** Rest state: the first rows, then "Show all N". */
export const LIST_REST = 3;

/** Hinted rows first (partly used, counted on), then split rows, then by date. */
export function sortForList(records: AllocationRecord[], focus: Focus, codes: ReadonlyMap<string, string>): AllocationRecord[] {
  const owners = allOwners(focus);
  const rank = (record: AllocationRecord) => (feedstockHint(record, focus.owner, focus.owners, codes) ? 0 : sharesOf(record, owners).length > 1 ? 1 : 2);
  return [...records].sort((a, b) => rank(a) - rank(b) || a.date.localeCompare(b.date) || a.code.localeCompare(b.code));
}

/** One row per record: where it goes (each owner's share) and its figure; a Total when there are several. */
export function RecordList({ records, stream, focus, codes }: {
  records: AllocationRecord[];
  stream: Stream;
  focus: Focus;
  codes: ReadonlyMap<string, string>;
}) {
  const [showAll, setShowAll] = useState(false);
  const owners = allOwners(focus);
  const rows = sortForList(records, focus, codes);
  const shown = showAll ? rows : rows.slice(0, LIST_REST);
  const total = rows.reduce((sum, record) => sum + (stream.pick(record) ?? 0), 0);
  return (
    <div className="flex min-w-0 flex-col gap-4" aria-live="polite">
      {/* A long credit batch code scrolls inside this box, never the page. */}
      <div className="min-w-0 overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-left">
            <th scope="col" className={cn("py-6 pr-12 body-small font-medium", MUTED)}>Record</th>
            <th scope="col" className={cn("w-[96px] py-6 pr-12 text-right body-small font-medium sm:w-[160px]", MUTED)}>Goes to</th>
            <th scope="col" className={cn("w-[64px] py-6 text-right body-small font-medium sm:w-[112px]", MUTED)}>{stream.unit}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((record) => {
            const hint = feedstockHint(record, focus.owner, focus.owners, codes);
            return (
              <tr key={record.id} className="[border-top:var(--row-divider)] align-top">
                <th scope="row" className="py-6 pr-12 text-left font-normal">
                  <span className="block body-small">{recordName(record)}</span>
                  <span className={cn("block body-caption", MUTED)}>{recordLine(record)}</span>
                  {hint && <HintMarker hint={hint} viewer={focus.owner} className="pt-2" />}
                </th>
                <td className="py-6 pr-12 text-right align-top body-small tabular-nums">
                  {sharesOf(record, owners).map((share) => (
                    <span key={share.owner.key} className={cn("flex flex-wrap justify-end gap-x-4", share.owner.key === focus.owner.key ? "font-medium" : MUTED)}>
                      <span className="whitespace-nowrap">{share.percent}%</span>
                      <span className={cn("whitespace-nowrap", !share.owner.notYet && "font-mono")}>{share.owner.notYet ? NOT_YET_LABEL.toLowerCase() : share.owner.label}</span>
                    </span>
                  ))}
                </td>
                <td className="py-6 text-right body-small tabular-nums">{formatNumber(stream.pick(record) ?? 0)}</td>
              </tr>
            );
          })}
        </tbody>
        {rows.length > 1 && (
          <tfoot>
            <tr className="[border-top:var(--hair-2)]">
              <th scope="row" className="py-6 pr-12 text-left body-small font-medium">Total</th>
              <td />
              <td className="py-6 text-right body-small font-medium tabular-nums">{formatNumber(total)}</td>
            </tr>
          </tfoot>
        )}
      </table>
      </div>
      {!showAll && rows.length > LIST_REST && <TextAction onClick={() => setShowAll(true)}>Show all {rows.length}</TextAction>}
    </div>
  );
}
