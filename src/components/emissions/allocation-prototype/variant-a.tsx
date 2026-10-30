/**
 * PROTOTYPE variant A, "Matrix ledger": every source record is a row, every
 * credit batch (or Removal) a column, plus Not yet allocated. A cell is the
 * share and the quantity; the column the page is about is tinted. One table
 * per line, each with its totals row, so a column reads down to what that
 * batch carries and a row reads across to 100%.
 */
"use client";

import { ExplanationInfo } from "@/components/ui/explanation-info";
import { cn } from "@/lib/utils";
import {
  GROUPS,
  NOT_YET_OWNER,
  fractionFor,
  formatQuantities,
  formatQuantity,
  groupTotals,
  recordsOf,
  sharesOf,
  totalsFor,
  type Focus,
  type GroupKey,
  type Owner,
} from "./fixture";
import { FAINT, GroupTitle, MUTED, PANEL, RecordLabel } from "./parts";

const TH = "px-12 py-10 text-right align-bottom body-small font-medium text-[var(--color-text-secondary)]";
const TD = "px-12 py-10 text-right align-top tabular-nums";
const STICKY = "sticky left-0 z-[1] bg-[var(--paper)] text-left";
const FOCUS_COL = "bg-[var(--st-run-bg)]";
const RECORD_COL_WIDTH = "w-[112px] min-w-[112px]";
const OWNER_COL_WIDTH = "min-w-[88px]";

function OwnerHeader({ owner, focused }: { owner: Owner; focused: boolean }) {
  return (
    <th scope="col" className={cn(TH, OWNER_COL_WIDTH, focused && cn(FOCUS_COL, "text-[var(--ink)] [box-shadow:inset_0_3px_0_var(--ink)]"))}>
      <span className="flex flex-col items-end">
        <span className={cn("whitespace-nowrap", focused && "font-medium")}>{owner.label}</span>
        <span className={cn("whitespace-nowrap body-caption font-normal", FAINT)}>{owner.notYet ? "In the bin" : owner.sub}</span>
      </span>
    </th>
  );
}

/**
 * Wide: columns in time order, a Whole record column, the Not yet allocated
 * column on every line so the columns stand in line from table to table.
 * Compact (phones, the sheet): this page's column first, the whole record
 * under its code, Not yet allocated only where something is still in a bin.
 */
function Matrix({ group, focus, compact }: { group: GroupKey; focus: Focus; compact: boolean }) {
  const records = recordsOf(group);
  const hasNotYet = records.some((record) => fractionFor(record, NOT_YET_OWNER) > 0);
  const ordered = compact ? [focus.owner, ...focus.owners.filter((owner) => owner.key !== focus.owner.key)] : focus.owners;
  const columns = hasNotYet || !compact ? [...ordered, NOT_YET_OWNER] : ordered;
  return (
        <table className={cn("w-full border-collapse", !compact && "table-fixed")}>
          {!compact && (
            <colgroup>
              <col className="w-[26%]" />
              <col className="w-[14%]" />
              {columns.map((owner) => <col key={owner.key} />)}
            </colgroup>
          )}
          <thead>
            <tr>
              <th scope="col" className={cn(TH, STICKY, compact && RECORD_COL_WIDTH)}>Record</th>
              {!compact && <th scope="col" className={TH}>Whole record</th>}
              {columns.map((owner) => <OwnerHeader key={owner.key} owner={owner} focused={owner.key === focus.owner.key} />)}
            </tr>
          </thead>
          <tbody>
            {records.map((record) => {
              const shares = sharesOf(record, focus.owners);
              return (
                <tr key={record.id} className="[border-top:var(--row-divider)]">
                  <th scope="row" className={cn(TD, STICKY, compact && RECORD_COL_WIDTH, "font-normal")}>
                    {compact ? (
                      <span className="flex min-w-0 flex-col">
                        <span className="body-small font-medium">{record.code}</span>
                        <span className={cn("body-caption", MUTED)}>{formatQuantities(record.quantities)}</span>
                      </span>
                    ) : (
                      <RecordLabel record={record} />
                    )}
                  </th>
                  {!compact && <td className={cn(TD, "body-small")}>{formatQuantities(record.quantities)}</td>}
                  {columns.map((owner) => {
                    const share = shares.find((candidate) => candidate.owner.key === owner.key);
                    const focused = owner.key === focus.owner.key;
                    return (
                      <td key={owner.key} className={cn(TD, focused && FOCUS_COL)}>
                        {share && (
                          <span className="flex flex-col items-end">
                            <span className={cn("body-small", focused || share.percent < 100 ? "font-medium" : "", owner.notYet && MUTED)}>{share.percent}%</span>
                            <span className={cn("whitespace-nowrap body-caption", MUTED)}>{formatQuantities(record.quantities, share.fraction)}</span>
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="[border-top:var(--hair-2)]">
              <th scope="row" className={cn(TD, STICKY, compact && RECORD_COL_WIDTH, "body-small font-medium")}>
                Total
                {compact && <span className={cn("block body-caption font-normal", MUTED)}>{formatQuantities(groupTotals(group))}</span>}
              </th>
              {!compact && <td className={cn(TD, "body-small font-medium")}>{formatQuantities(groupTotals(group))}</td>}
              {columns.map((owner) => {
                const totals = totalsFor(owner, group);
                const focused = owner.key === focus.owner.key;
                return (
                  <td key={owner.key} className={cn(TD, "body-small font-medium", focused && FOCUS_COL, owner.notYet && MUTED)}>
                    {totals.map((quantity) => <span key={quantity.unit} className="block whitespace-nowrap">{formatQuantity(quantity)}</span>)}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
  );
}

function GroupTable({ group, focus }: { group: GroupKey; focus: Focus }) {
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
      <div className={cn("min-w-0 overflow-x-auto [border-top:var(--row-divider)]", !sheet && "md:hidden")}>
        <Matrix group={group} focus={focus} compact />
      </div>
      {!sheet && (
        <div className="hidden min-w-0 [border-top:var(--row-divider)] md:block">
          <Matrix group={group} focus={focus} compact={false} />
        </div>
      )}
    </section>
  );
}

export function VariantA({ focus }: { focus: Focus }) {
  const across = focus.surface === "batch" ? "credit batches" : "Removals";
  return (
    <section aria-labelledby="allocation-a" className="flex min-w-0 flex-col gap-16">
      <span className="inline-flex items-center gap-6">
        <h2 id="allocation-a" className="title-heading-3">Allocation</h2>
        <ExplanationInfo
          title="Allocation"
          hint={`Each record's activity is split across ${across}, so every record adds up to 100% and nothing is counted twice. noma sends the quantities; Isometric turns them into emissions.`}
        />
      </span>
      {GROUPS.map((group) => <GroupTable key={group.key} group={group.key} focus={focus} />)}
    </section>
  );
}
