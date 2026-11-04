/**
 * The Table view, a matrix ledger: every source record is a row, every credit
 * batch (or Removal) a column, plus Not yet allocated. A cell is the share and
 * the quantity; the column the page is about is tinted. Records that sit whole
 * on one owner fold into one line per owner ("3 production runs, all on
 * CB-26-002") that opens to list them. Rows that carry hint A never fold.
 * Compact (phones, the Removal sheet) is three columns, Record, this page and
 * Elsewhere, so it fits 390 px without scrolling sideways.
 */
"use client";

import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { AllocationRecord, EmissionAllocation, GroupKey } from "@/types/emission-allocation";
import { CountedOnNote, HintMarker } from "./allocation-hint";
import { formatAmounts, formatValue, recordName } from "./allocation-format";
import {
  GROUP_ORDER,
  allOwners,
  amountsOf,
  batchCodesOf,
  basisFor,
  feedstockHint,
  recordsOf,
  sharesOf,
  totalAmounts,
  type Amount,
  type Focus,
  type Owner,
} from "./allocation-model";
import { FAINT, GroupTitle, MUTED, NotYetSwatch, PANEL, RecordLabel } from "./allocation-parts";

const TH = "px-12 py-10 text-right align-bottom body-small font-medium text-[var(--color-text-secondary)]";
const TD = "px-12 py-10 text-right align-top tabular-nums";
const STICKY = "sticky left-0 z-[1] bg-[var(--paper)] text-left";
const FOCUS_COL = "bg-[var(--st-run-bg)]";
/** Compact: tighter cells, fixed share columns, the record column takes the rest. */
const TH_C = "px-8 py-10 text-right align-bottom body-small font-medium text-[var(--color-text-secondary)] first:pl-12 last:pr-12";
const TD_C = "px-8 py-10 text-right align-top tabular-nums first:pl-12 last:pr-12";
const FOCUS_COL_WIDTH_C = "w-[88px]";
const ELSEWHERE_COL_WIDTH_C = "w-[116px]";
/** Wide matrix: the record columns, then this width per owner, so many batches scroll instead of squeezing. */
const RECORD_COLS_PX = 380;
const OWNER_COL_PX = 104;
/** Fold only where it saves rows: two or more whole records on one owner. */
const MIN_FOLD = 2;
const RECORD_NAME_COL_PX = 240;
const CARET_PX = 14;

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

type Row = { kind: "record"; record: AllocationRecord } | { kind: "fold"; owner: Owner; records: AllocationRecord[] };

interface Ctx {
  focus: Focus;
  codes: ReadonlyMap<string, string>;
  compact: boolean;
}

function rowsOf(records: AllocationRecord[], ctx: Ctx): Row[] {
  const owners = allOwners(ctx.focus);
  const wholeOwner = (record: AllocationRecord) => {
    if (feedstockHint(record, ctx.focus.owner, ctx.focus.owners, ctx.codes)) return null;
    const shares = sharesOf(record, owners);
    return shares.length === 1 && !shares[0].owner.notYet ? shares[0].owner : null;
  };
  const byOwner = new Map<string, AllocationRecord[]>();
  for (const record of records) {
    const owner = wholeOwner(record);
    if (owner) byOwner.set(owner.key, [...(byOwner.get(owner.key) ?? []), record]);
  }
  const rows: Row[] = [];
  const folded = new Set<string>();
  for (const record of records) {
    const owner = wholeOwner(record);
    const siblings = owner ? byOwner.get(owner.key) ?? [] : [];
    if (!owner || siblings.length < MIN_FOLD) rows.push({ kind: "record", record });
    else if (!folded.has(owner.key)) {
      folded.add(owner.key);
      rows.push({ kind: "fold", owner, records: siblings });
    }
  }
  return rows;
}

function OwnerHeader({ owner, focused, compact }: { owner: Owner; focused: boolean; compact: boolean }) {
  return (
    <th scope="col" className={cn(compact ? TH_C : TH, focused && cn(FOCUS_COL, "text-[var(--ink)] [box-shadow:inset_0_3px_0_var(--ink)]"))}>
      <span className="flex flex-col items-end">
        <span className={cn("inline-flex items-center gap-6 whitespace-nowrap", focused && "font-medium")}>
          <NotYetSwatch owner={owner} />
          <span className={cn(!owner.notYet && "font-mono")}>{owner.label}</span>
        </span>
        {!owner.notYet && <span className={cn("body-caption font-normal", FAINT)}>{owner.sub}</span>}
      </span>
    </th>
  );
}

/** One figure per line, so "63 L, 513 kWh" never clips in a narrow column. */
function AmountLines({ amounts, derived = false, className }: { amounts: Amount[]; /** Shares and totals leave out a unit nobody recorded; the record's own cell says so. */ derived?: boolean; className?: string }) {
  return (
    <span className={cn("flex flex-col items-end", className)}>
      {amounts.filter((amount) => !derived || amount.value !== null).map((amount) => <span key={amount.unit} className="whitespace-nowrap">{formatValue(amount.value, amount.unit)}</span>)}
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

function Matrix({ group, records, ctx }: { group: GroupKey; records: AllocationRecord[]; ctx: Ctx }) {
  const { focus, compact } = ctx;
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const rows = rowsOf(records, ctx);
  const owners = allOwners(focus);
  const columns = compact ? [focus.owner] : owners;
  const th = compact ? TH_C : TH;
  const td = compact ? TD_C : TD;
  const others = (record: AllocationRecord) => sharesOf(record, owners).filter((share) => share.owner.key !== focus.owner.key);
  const recordRow = (record: AllocationRecord, nested: boolean) => {
    const shares = sharesOf(record, owners);
    const rowHint = feedstockHint(record, focus.owner, focus.owners, ctx.codes);
    return (
      <tr key={record.id} className={cn("[border-top:var(--row-divider)]", nested && "bg-[var(--row-hover-bg-solid)]")}>
        <th scope="row" className={cn(td, STICKY, "font-normal", nested && "bg-[var(--row-hover-bg-solid)] pl-32")}>
          {compact ? (
            <span className="flex min-w-0 flex-col">
              <span className="body-small font-medium">{recordName(record)}</span>
              <span className={cn("body-caption", MUTED)}>{formatAmounts(amountsOf(record))}</span>
            </span>
          ) : (
            <RecordLabel record={record} />
          )}
          {focus.surface === "removal" && shares.filter(share => basisFor(record, share.owner).some(basis => basis.kind === "wouldClaim")).map(share => (
            <span key={share.owner.key} className={cn("block body-caption", MUTED)}>Would be sent with {share.owner.label}</span>
          ))}
          {rowHint && <HintMarker hint={rowHint} viewer={focus.owner} className="pt-4" />}
        </th>
        {!compact && <td className={cn(TD, "body-small")}><AmountLines amounts={amountsOf(record)} /></td>}
        {columns.map((owner) => {
          const share = shares.find((candidate) => candidate.owner.key === owner.key);
          const focused = owner.key === focus.owner.key;
          const countedOn = focused && rowHint?.kind === "countedOn";
          return (
            <td key={owner.key} className={cn(td, focused && FOCUS_COL)}>
              {share && (
                <span className="flex flex-col items-end">
                  <span className={cn("body-small", focused || share.percent < 100 ? "font-medium" : "", owner.notYet && MUTED)}>{share.percent}%</span>
                  <AmountLines derived amounts={amountsOf(record, share.fraction)} className={cn("body-caption", MUTED)} />
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
  const style = compact ? undefined : { minWidth: RECORD_COLS_PX + columns.length * OWNER_COL_PX };
  return (
    <table className="w-full table-fixed border-collapse" style={style}>
      {compact ? (
        <colgroup>
          <col />
          <col className={FOCUS_COL_WIDTH_C} />
          <col className={ELSEWHERE_COL_WIDTH_C} />
        </colgroup>
      ) : (
        <colgroup>
          <col style={{ width: RECORD_NAME_COL_PX }} />
          <col style={{ width: RECORD_COLS_PX - RECORD_NAME_COL_PX }} />
          {columns.map((owner) => <col key={owner.key} style={{ width: OWNER_COL_PX }} />)}
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
          if (row.kind === "record") return [recordRow(row.record, false)];
          const isOpen = open.has(row.owner.key);
          const [one, many] = (compact ? FOLD_NOUNS_SHORT : FOLD_NOUNS)[group];
          const sum = totalAmounts(row.records);
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
                  <CaretRightIcon size={CARET_PX} aria-hidden className={cn("mt-4 shrink-0 transition-transform", FAINT, isOpen && "rotate-90")} />
                  <span className="flex min-w-0 flex-col">
                    <span className="body-small font-medium">{row.records.length} {row.records.length === 1 ? one : many}</span>
                    {compact && <span className={cn("body-caption", MUTED)}>{formatAmounts(sum, true)}</span>}
                    {focus.surface === "removal" && row.records.every(record => basisFor(record, row.owner).some(basis => basis.kind === "wouldClaim")) && (
                      <span className={cn("body-caption", MUTED)}>Would be sent with {row.owner.label}</span>
                    )}
                  </span>
                </button>
              </th>
              {!compact && <td className={cn(TD, "body-small")}><AmountLines derived amounts={sum} /></td>}
              {columns.map((owner) => {
                const focused = owner.key === focus.owner.key;
                return (
                  <td key={owner.key} className={cn(td, focused && FOCUS_COL)}>
                    {owner.key === row.owner.key && (
                      <span className="flex flex-col items-end">
                        <span className={cn("body-small", focused && "font-medium")}>100%</span>
                        <AmountLines derived amounts={sum} className={cn("body-caption", MUTED)} />
                      </span>
                    )}
                  </td>
                );
              })}
              {compact && (
                <td className={td}>{row.owner.key !== focus.owner.key && <ElsewhereCell shares={[{ owner: row.owner, percent: 100 }]} />}</td>
              )}
            </tr>
          );
          return isOpen ? [foldRow, ...row.records.map((record) => recordRow(record, true))] : [foldRow];
        })}
      </tbody>
      <tfoot>
        <tr className="[border-top:var(--hair-2)]">
          <th scope="row" className={cn(td, STICKY, "body-small font-medium")}>
            Total
            {compact && <span className={cn("block body-caption font-normal", MUTED)}>{formatAmounts(totalAmounts(records), true)}</span>}
          </th>
          {!compact && <td className={cn(TD, "body-small font-medium")}><AmountLines derived amounts={totalAmounts(records)} /></td>}
          {columns.map((owner) => (
            <td key={owner.key} className={cn(td, "body-small font-medium", owner.key === focus.owner.key && FOCUS_COL, owner.notYet && MUTED)}>
              <AmountLines derived amounts={totalAmounts(records, owner)} />
            </td>
          ))}
          {compact && (
            <td className={cn(td, "body-caption", MUTED)}>
              <AmountLines derived amounts={elsewhereTotals(records, focus)} />
            </td>
          )}
        </tr>
      </tfoot>
    </table>
  );
}

/** What every owner but this page carries, per unit. Not recorded stays not recorded. */
function elsewhereTotals(records: AllocationRecord[], focus: Focus): Amount[] {
  const whole = totalAmounts(records);
  const mine = totalAmounts(records, focus.owner);
  return whole.map((amount) => ({
    unit: amount.unit,
    value: amount.value === null ? null : amount.value - (mine.find((candidate) => candidate.unit === amount.unit)?.value ?? 0),
  }));
}

function GroupTable({ group, records, ctx }: { group: GroupKey; records: AllocationRecord[]; ctx: Ctx }) {
  const { focus } = ctx;
  // The Removal sheet is phone-narrow at every width: compact there.
  const sheet = focus.surface === "removal";
  return (
    <section className={cn(PANEL, "flex min-w-0 flex-col")}>
      <div className="flex flex-wrap items-center justify-between gap-x-16 gap-y-4 px-16 py-12">
        <GroupTitle group={group} />
      </div>
      <div className={cn("min-w-0 [border-top:var(--row-divider)]", !sheet && "md:hidden")}>
        <Matrix group={group} records={records} ctx={{ ...ctx, compact: true }} />
      </div>
      {!sheet && (
        <div className="hidden min-w-0 overflow-x-auto [border-top:var(--row-divider)] md:block">
          <Matrix group={group} records={records} ctx={{ ...ctx, compact: false }} />
        </div>
      )}
    </section>
  );
}

export function TableView({ allocation, focus }: { allocation: EmissionAllocation; focus: Focus }) {
  const codes = batchCodesOf(allocation);
  return (
    <div className="flex min-w-0 flex-col gap-16">
      {GROUP_ORDER.map((group) => {
        const records = recordsOf(allocation.records, group);
        return records.length ? <GroupTable key={group} group={group} records={records} ctx={{ focus, codes, compact: false }} /> : null;
      })}
    </div>
  );
}
