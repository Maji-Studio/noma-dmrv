/**
 * PROTOTYPE (never merge). The Table view of the allocation (round 1 variant
 * A, "Matrix ledger"): every source record is a row, every credit batch (or
 * Removal) a column, plus Not yet allocated. A cell is the share and the
 * quantity; the column the page is about is tinted. Records that sit whole on
 * one batch fold into one line per batch ("3 production runs, all on
 * CB-26-002") that opens to list them. Totals rows stay.
 *
 * Round 3: rows that carry a hint for this page never fold. Treatment A marks
 * them under the record; both treatments say "Counted on" in this page's
 * column when its runs drew from a delivery another batch carries. Compact
 * (phones, the sheet) is three columns, Record, this page and Elsewhere, so it
 * fits 390 px without scrolling sideways.
 */
"use client";

import { useState } from "react";
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import {
  GROUPS,
  NOT_YET_OWNER,
  type SourceRecord,
  feedstockHint,
  formatQuantities,
  formatQuantity,
  groupTotals,
  recordsOf,
  sharesOf,
  totalsFor,
  type Focus,
  type GroupKey,
  type Owner,
  type Quantity,
} from "./fixture";
import { CountedOnNote, HintMarker, type HintMode } from "./hints";
import { FAINT, GroupTitle, MUTED, PANEL, RecordLabel, Swatch } from "./parts";

const TH = "px-12 py-10 text-right align-bottom body-small font-medium text-[var(--color-text-secondary)]";
const TD = "px-12 py-10 text-right align-top tabular-nums";
const STICKY = "sticky left-0 z-[1] bg-[var(--paper)] text-left";
const FOCUS_COL = "bg-[var(--st-run-bg)]";
const OWNER_COL_WIDTH = "min-w-[88px]";
/** Compact: tighter cells, fixed share columns, the record column takes the rest. */
const TH_C = "px-8 py-10 text-right align-bottom body-small font-medium text-[var(--color-text-secondary)] first:pl-12 last:pr-12";
const TD_C = "px-8 py-10 text-right align-top tabular-nums first:pl-12 last:pr-12";
const FOCUS_COL_WIDTH_C = "w-[88px]";
const ELSEWHERE_COL_WIDTH_C = "w-[116px]";
const FLASH = "bg-[var(--st-run-bg)]";

function OwnerHeader({ owner, focused, compact = false }: { owner: Owner; focused: boolean; compact?: boolean }) {
  return (
    <th scope="col" className={cn(compact ? TH_C : cn(TH, OWNER_COL_WIDTH), focused && cn(FOCUS_COL, "text-[var(--ink)] [box-shadow:inset_0_3px_0_var(--ink)]"))}>
      <span className="flex flex-col items-end">
        <span className={cn("inline-flex items-center gap-6 whitespace-nowrap", focused && "font-medium")}>
          {owner.notYet && <Swatch owner={owner} owners={[]} />}
          {owner.label}
        </span>
        <span className={cn("whitespace-nowrap body-caption font-normal", FAINT)}>{owner.notYet ? "In the bin" : owner.sub}</span>
      </span>
    </th>
  );
}

/**
 * Wide: columns in time order, a Whole record column, the Not yet allocated
 * column on every line so the columns stand in line from table to table.
 * Compact (phones, the sheet): the whole record under its code, this page's
 * column, then one Elsewhere column naming the other owners and their shares.
 */
/** Short nouns for the narrow record column on phones and in the sheet. */
const FOLD_NOUNS_SHORT: Record<GroupKey, [string, string]> = {
  feedstockTransport: ["record", "records"],
  production: ["run", "runs"],
  deliveryTransport: ["delivery", "deliveries"],
  manual: ["entry", "entries"],
};
const FOLD_NOUNS: Record<GroupKey, [string, string]> = {
  feedstockTransport: ["feedstock record", "feedstock records"],
  production: ["production run", "production runs"],
  deliveryTransport: ["delivery", "deliveries"],
  manual: ["manual entry", "manual entries"],
};
/** Fold only where it saves rows: two or more whole records on one owner. */
const MIN_FOLD = 2;

type Row = { kind: "record"; record: SourceRecord } | { kind: "fold"; owner: Owner; records: SourceRecord[] };

function rowsOf(group: GroupKey, owners: Owner[], focusOwner: Owner): Row[] {
  const records = recordsOf(group);
  const wholeOwner = (record: SourceRecord) => {
    if (feedstockHint(record, focusOwner)) return null;
    const shares = sharesOf(record, owners);
    return shares.length === 1 && !shares[0].owner.notYet ? shares[0].owner : null;
  };
  const byOwner = new Map<string, SourceRecord[]>();
  for (const record of records) {
    const owner = wholeOwner(record);
    if (owner) byOwner.set(owner.key, [...(byOwner.get(owner.key) ?? []), record]);
  }
  const rows: Row[] = [];
  const folded = new Set<string>();
  for (const record of records) {
    const owner = wholeOwner(record);
    const siblings = owner ? byOwner.get(owner.key) ?? [] : [];
    if (!owner || siblings.length < MIN_FOLD) {
      rows.push({ kind: "record", record });
    } else if (!folded.has(owner.key)) {
      folded.add(owner.key);
      rows.push({ kind: "fold", owner, records: siblings });
    }
  }
  return rows;
}

function sumQuantities(records: SourceRecord[]) {
  const byUnit = new Map<string, { value: number; unit: SourceRecord["quantities"][number]["unit"]; label: string }>();
  for (const record of records) {
    for (const quantity of record.quantities) {
      const previous = byUnit.get(quantity.unit);
      byUnit.set(quantity.unit, { ...quantity, value: (previous?.value ?? 0) + quantity.value });
    }
  }
  return [...byUnit.values()];
}

function minus(all: Quantity[], part: Quantity[]): Quantity[] {
  return all
    .map((quantity) => ({ ...quantity, value: quantity.value - (part.find((candidate) => candidate.unit === quantity.unit && candidate.label === quantity.label)?.value ?? 0) }))
    .filter((quantity) => quantity.value > 0);
}

/** One quantity per line, so "63 L, 513 kWh" never clips in a narrow column. */
function QuantityLines({ quantities, fraction = 1, className }: { quantities: Quantity[]; fraction?: number; className?: string }) {
  return (
    <span className={cn("flex flex-col items-end", className)}>
      {quantities.map((quantity) => <span key={quantity.unit} className="whitespace-nowrap">{formatQuantities([quantity], fraction)}</span>)}
    </span>
  );
}

/** One line per other owner: "70% CB-26-002". */
function ElsewhereCell({ shares }: { shares: { owner: Owner; percent: number }[] }) {
  return (
    <span className="flex flex-col items-end">
      {shares.map((share) => (
        <span key={share.owner.key} className={cn("flex flex-wrap justify-end gap-x-4 body-caption", MUTED)}>
          <span className="whitespace-nowrap tabular-nums">{share.percent}%</span>
          <span className="whitespace-nowrap">{share.owner.notYet ? "not yet allocated" : share.owner.label}</span>
        </span>
      ))}
    </span>
  );
}

function Matrix({ group, focus, compact, hint, flash }: { group: GroupKey; focus: Focus; compact: boolean; hint: HintMode; flash: string | null }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const rows = rowsOf(group, focus.owners, focus.owner);
  const columns = compact ? [focus.owner] : [...focus.owners, NOT_YET_OWNER];
  const th = compact ? TH_C : TH;
  const td = compact ? TD_C : TD;
  const others = (record: SourceRecord) => sharesOf(record, focus.owners).filter((share) => share.owner.key !== focus.owner.key);
  const recordRow = (record: SourceRecord, nested: boolean) => {
    const shares = sharesOf(record, focus.owners);
    const rowHint = feedstockHint(record, focus.owner);
    const flashed = flash === record.id;
    return (
      <tr key={record.id} className={cn("[border-top:var(--row-divider)] transition-colors", nested && "bg-[var(--row-hover-bg-solid)]", flashed && FLASH)}>
        <th
          scope="row"
          data-record-row={record.id}
          tabIndex={-1}
          className={cn(td, STICKY, "font-normal outline-none focus-visible:outline-[1.5px] focus-visible:outline-[var(--color-interaction)]", nested && "bg-[var(--row-hover-bg-solid)] pl-32", flashed && FLASH)}
        >
          {compact ? (
            <span className="flex min-w-0 flex-col">
              <span className="body-small font-medium">{record.code}</span>
              <span className={cn("body-caption", MUTED)}>{formatQuantities(record.quantities)}</span>
            </span>
          ) : (
            <RecordLabel record={record} />
          )}
          {rowHint && hint === "a" && <HintMarker hint={rowHint} focus={focus} className="pt-4" />}
        </th>
        {!compact && <td className={cn(TD, "body-small")}>{formatQuantities(record.quantities)}</td>}
        {columns.map((owner) => {
          const share = shares.find((candidate) => candidate.owner.key === owner.key);
          const focused = owner.key === focus.owner.key;
          const countedOn = focused && rowHint?.kind === "countedOn";
          return (
            <td key={owner.key} className={cn(td, focused && FOCUS_COL)}>
              {share && (
                <span className="flex flex-col items-end">
                  <span className={cn("body-small", focused || share.percent < 100 ? "font-medium" : "", owner.notYet && MUTED)}>{share.percent}%</span>
                  <QuantityLines quantities={record.quantities} fraction={share.fraction} className={cn("body-caption", MUTED)} />
                </span>
              )}
              {countedOn && (
                <span className="flex flex-col items-end">
                  <span className="body-small font-medium">0%</span>
                  <CountedOnNote hint={rowHint} />
                </span>
              )}
            </td>
          );
        })}
        {compact && (
          <td className={cn(td, ELSEWHERE_COL_WIDTH_C)}>
            <ElsewhereCell shares={others(record)} />
          </td>
        )}
      </tr>
    );
  };
  return (
    <table className={cn("w-full border-collapse", "table-fixed")}>
      {compact ? (
        <colgroup>
          <col />
          <col className={FOCUS_COL_WIDTH_C} />
          <col className={ELSEWHERE_COL_WIDTH_C} />
        </colgroup>
      ) : (
        <colgroup>
          <col className="w-[26%]" />
          <col className="w-[14%]" />
          {columns.map((owner) => <col key={owner.key} />)}
        </colgroup>
      )}
      <thead>
        <tr>
          <th scope="col" className={cn(th, STICKY)}>Record</th>
          {!compact && <th scope="col" className={TH}>Whole record</th>}
          {columns.map((owner) => <OwnerHeader key={owner.key} owner={owner} focused={owner.key === focus.owner.key} compact={compact} />)}
          {compact && (
            <th scope="col" className={th}>
              <span className="flex flex-col items-end">
                <span>Elsewhere</span>
                <span className={cn("body-caption font-normal", FAINT)}>{focus.surface === "batch" ? "Other batches" : "Other Removals"}</span>
              </span>
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.flatMap((row) => {
          if (row.kind === "fold") {
            const isOpen = open.has(row.owner.key);
            const [one, many] = (compact ? FOLD_NOUNS_SHORT : FOLD_NOUNS)[group];
            const sum = sumQuantities(row.records);
            const toggle = () =>
              setOpen((current) => {
                const next = new Set(current);
                if (next.has(row.owner.key)) next.delete(row.owner.key);
                else next.add(row.owner.key);
                return next;
              });
            const foldRow = (
              <tr key={`fold-${row.owner.key}`} className="[border-top:var(--row-divider)]">
                <th scope="row" className={cn(td, STICKY, "font-normal")}>
                  <button type="button" aria-expanded={isOpen} onClick={toggle} className="-my-6 flex min-h-44 w-full items-start gap-6 text-left">
                    <CaretRightIcon size={14} aria-hidden className={cn("mt-4 shrink-0 transition-transform", FAINT, isOpen && "rotate-90")} />
                    <span className="flex min-w-0 flex-col">
                      <span className="body-small font-medium">{row.records.length} {row.records.length === 1 ? one : many}</span>
                      <span className={cn("body-caption", MUTED)}>{compact ? formatQuantities(sum) : `all on ${row.owner.label}`}</span>
                    </span>
                  </button>
                </th>
                {!compact && <td className={cn(TD, "body-small")}>{formatQuantities(sum)}</td>}
                {columns.map((owner) => {
                  const focused = owner.key === focus.owner.key;
                  return (
                    <td key={owner.key} className={cn(td, focused && FOCUS_COL)}>
                      {owner.key === row.owner.key && (
                        <span className="flex flex-col items-end">
                          <span className={cn("body-small", focused && "font-medium")}>100%</span>
                          <QuantityLines quantities={sum} className={cn("body-caption", MUTED)} />
                        </span>
                      )}
                    </td>
                  );
                })}
                {compact && (
                  <td className={td}>
                    {row.owner.key !== focus.owner.key && <ElsewhereCell shares={[{ owner: row.owner, percent: 100 }]} />}
                  </td>
                )}
              </tr>
            );
            return isOpen ? [foldRow, ...row.records.map((record) => recordRow(record, true))] : [foldRow];
          }
          return [recordRow(row.record, false)];
        })}
      </tbody>
      <tfoot>
        <tr className="[border-top:var(--hair-2)]">
          <th scope="row" className={cn(td, STICKY, "body-small font-medium")}>
            Total
            {compact && <span className={cn("block body-caption font-normal", MUTED)}>{formatQuantities(groupTotals(group))}</span>}
          </th>
          {!compact && <td className={cn(TD, "body-small font-medium")}>{formatQuantities(groupTotals(group))}</td>}
          {columns.map((owner) => {
            const totals = totalsFor(owner, group);
            const focused = owner.key === focus.owner.key;
            return (
              <td key={owner.key} className={cn(td, "body-small font-medium", focused && FOCUS_COL, owner.notYet && MUTED)}>
                {totals.map((quantity) => <span key={quantity.unit} className="block whitespace-nowrap">{formatQuantity(quantity)}</span>)}
              </td>
            );
          })}
          {compact && (
            <td className={cn(td, "body-caption", MUTED)}>
              {minus(groupTotals(group), totalsFor(focus.owner, group)).map((quantity) => <span key={quantity.unit} className="block whitespace-nowrap">{formatQuantity(quantity)}</span>)}
            </td>
          )}
        </tr>
      </tfoot>
    </table>
  );
}

function GroupTable({ group, focus, hint, flash }: { group: GroupKey; focus: Focus; hint: HintMode; flash: string | null }) {
  const carried = totalsFor(focus.owner, group);
  // The Removal sheet is phone-narrow at every width: compact there.
  const sheet = focus.surface === "removal";
  return (
    <section className={cn(PANEL, "flex min-w-0 flex-col")}>
      <div className="flex flex-wrap items-center justify-between gap-x-16 gap-y-4 px-16 py-12">
        <GroupTitle group={group} />
        <span className={cn("body-small", MUTED)}>
          {focus.owner.label}: <span className="font-medium text-[var(--ink)] tabular-nums">{carried.length ? formatQuantities(carried) : "None"}</span>
        </span>
      </div>
      <div className={cn("min-w-0 [border-top:var(--row-divider)]", !sheet && "md:hidden")}>
        <Matrix group={group} focus={focus} compact hint={hint} flash={flash} />
      </div>
      {!sheet && (
        <div className="hidden min-w-0 [border-top:var(--row-divider)] md:block">
          <Matrix group={group} focus={focus} compact={false} hint={hint} flash={flash} />
        </div>
      )}
    </section>
  );
}

export function TableView({ focus, hint, flash }: { focus: Focus; hint: HintMode; flash: string | null }) {
  return (
    <div className="flex min-w-0 flex-col gap-16">
      {GROUPS.map((group) => <GroupTable key={group.key} group={group.key} focus={focus} hint={hint} flash={flash} />)}
    </div>
  );
}
