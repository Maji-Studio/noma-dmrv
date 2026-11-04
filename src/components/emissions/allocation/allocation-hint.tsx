/**
 * Hint A: a delivery's whole transport sits on one credit batch. On a page
 * that carries it, a marker says how much of the delivery that page used; on a
 * page whose runs drew from it, "Counted on" names the batch that carries it.
 * Either way the (i) shows where the kilograms went.
 */
"use client";

import { CircleHalfIcon } from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";
import { ExplanationInfo } from "@/components/ui/explanation-info";
import { cn } from "@/lib/utils";
import { formatDay, formatKg, formatValue } from "./allocation-format";
import type { FeedstockHint, Owner } from "./allocation-model";
import { MUTED } from "./allocation-parts";

const ICON_PX = 14;
const CODE_PATTERN = /((?:CB|RM|FS|PR)-\d{2}-\d{3})/;

/** Keeps record codes whole when a line wraps ("CB-26-001", never "CB-" and "26-001"). */
function keepCodes(text: string): ReactNode {
  return text.split(CODE_PATTERN).map((part, index) => (index % 2 ? <span key={index} className="whitespace-nowrap">{part}</span> : part));
}

/** "Used 2,000 of 10,000 kg": what the page's runs drew, of the delivery. */
export function markerText(hint: FeedstockHint): string {
  return `Used ${formatKg(hint.usedKg).replace(" kg", "")} of ${formatKg(hint.use.wetKg)}`;
}

/** The (i) sentence: who carries the whole leg and why. */
export function whySentence(hint: FeedstockHint, viewer: Owner): string {
  const { use, record, ownerLabel } = hint;
  const whole = use.tonneKm === null ? "transport" : formatValue(use.tonneKm, "t·km");
  const lead = use.firstRun
    ? `${ownerLabel} carries the whole ${whole} because its run ${use.firstRun.code} drew from ${record.code} first, on ${formatDay(use.firstRun.date)}.`
    : `${ownerLabel} carries the whole ${whole} of ${record.code}.`;
  if (hint.kind === "partly") return `${lead} Batches that drew from it later show Counted on ${ownerLabel}. Lost mass never counts.`;
  return `${lead} The ${formatKg(hint.usedKg)} ${viewer.label} drew is counted on ${ownerLabel}, so ${viewer.label} carries none of it.`;
}

interface WentRow {
  key: string;
  name: string;
  sub?: string;
  kg: number;
}

/** Where every kilogram of the delivery went: used per batch, then lost, in product, still in the bin. */
export function wentRows(hint: FeedstockHint): WentRow[] {
  const { use } = hint;
  const extra: WentRow[] = [
    { key: "unbatched", name: "Drawn by runs on no credit batch", kg: use.unbatchedRunKg },
    { key: "ingredient", name: "Used in a product", kg: use.ingredientKg },
    { key: "count", name: "Stock count", kg: use.countKg },
    { key: "lost", name: "Lost", sub: "Never counts", kg: use.lostKg },
    { key: "still", name: `Still in ${use.bin}`, kg: use.stillKg },
  ].filter((row) => row.kg !== 0);
  return [
    ...use.used.map((entry) => ({
      key: entry.creditBatchId,
      name: entry.code,
      sub: `Drawn by ${entry.runs.join(", ")}${entry.creditBatchId === use.owner ? ", carries the transport" : ""}`,
      kg: entry.kg,
    })),
    ...extra,
  ];
}

function WhereItWent({ hint }: { hint: FeedstockHint }) {
  const { use, record } = hint;
  return (
    <table className="w-full border-collapse">
      <caption className={cn("pb-6 text-left body-caption font-medium", MUTED)}>Where the {formatKg(use.wetKg)} went</caption>
      <tbody>
        {wentRows(hint).map((row) => (
          <tr key={row.key} className="[border-top:var(--row-divider)] align-top">
            <th scope="row" className="py-6 pr-12 text-left font-normal">
              <span className="block body-small">{row.name}</span>
              {row.sub && <span className={cn("block body-caption", MUTED)}>{row.sub}</span>}
            </th>
            <td className="py-6 text-right body-small tabular-nums">{formatKg(row.kg)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="[border-top:var(--hair-2)]">
          <th scope="row" className="py-6 pr-12 text-left body-small font-medium">{record.code}, {formatDay(record.date)}</th>
          <td className="py-6 text-right body-small font-medium tabular-nums">{formatKg(use.wetKg)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

/** "Used 8,000 of 10,000 kg (i)" under a row. Inline, so it wraps as text in a narrow column. */
export function HintMarker({ hint, viewer, className }: { hint: FeedstockHint; viewer: Owner; className?: string }) {
  return (
    <span className={cn("block body-caption text-[var(--color-text-primary)]", className)}>
      <CircleHalfIcon size={ICON_PX} aria-hidden className="mr-4 inline-block align-[-2px] text-[var(--clr-dark-purple-60)]" />
      {markerText(hint)}
      <ExplanationInfo title={`${hint.record.code} transport`} hint={keepCodes(whySentence(hint, viewer))} className="-my-6 ml-2">
        <WhereItWent hint={hint} />
      </ExplanationInfo>
    </span>
  );
}

/** The receiving side, in this page's own share cell: "Counted on CB-26-001". */
export function CountedOnNote({ hint }: { hint: FeedstockHint }) {
  if (hint.kind !== "countedOn") return null;
  return (
    <span className={cn("flex flex-wrap justify-end gap-x-4 body-caption", MUTED)}>
      <span className="whitespace-nowrap">Counted on</span>
      <span className="whitespace-nowrap font-mono text-[var(--color-text-primary)]">{hint.ownerLabel}</span>
    </span>
  );
}
