/**
 * PROTOTYPE variant B, "Record bars": only the records this batch (or
 * Removal) touches, each drawn as one 100% bar split across every owner.
 * This page's part is solid and outlined, the others fade, what is still in
 * the bin is hatched. A tap opens the quantities and what each part is made of.
 */
"use client";

import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr";
import { ExplanationInfo } from "@/components/ui/explanation-info";
import { segmentWidths } from "@/components/ui/segment-bar/segment-bar";
import { cn } from "@/lib/utils";
import {
  GROUPS,
  basisFor,
  formatKg,
  formatQuantities,
  formatQuantity,
  recordsCarriedBy,
  sharesOf,
  totalsFor,
  type Focus,
  type GroupKey,
  type SourceRecord,
} from "./fixture";
import { FAINT, GroupTitle, HATCH, MUTED, PANEL, RecordLabel, Swatch, ownerFill } from "./parts";

function Bar({ record, focus }: { record: SourceRecord; focus: Focus }) {
  const shares = sharesOf(record, focus.owners);
  const widths = segmentWidths(shares.map((share) => ({ label: share.owner.key, mass: share.fraction, category: "dry-batch" as const })));
  return (
    <div className="flex h-16 w-full" aria-hidden>
      {shares.map((share, index) => {
        const focused = share.owner.key === focus.owner.key;
        const fill = ownerFill(share.owner, focus.owners);
        return (
          <span
            key={share.owner.key}
            className={cn(
              "relative h-full border border-[var(--color-border-secondary)]",
              index > 0 && "border-l-0",
              !fill && HATCH,
              focused ? "z-[1] outline outline-2 outline-[var(--ink)]" : "opacity-40",
            )}
            style={{ width: `${widths[index]}%`, background: fill }}
          />
        );
      })}
    </div>
  );
}

function RecordRow({ record, focus }: { record: SourceRecord; focus: Focus }) {
  const shares = sharesOf(record, focus.owners);
  const whole = shares.length === 1;
  if (whole) {
    // Nothing to split: no bar, no tap.
    return (
      <div className="flex items-start justify-between gap-12 px-16 py-12 [border-top:var(--row-divider)] first:[border-top:none]">
        <span className="flex min-w-0 flex-col gap-4">
          <RecordLabel record={record} />
          <span className={cn("body-caption", MUTED)}>All on {shares[0].owner.label}</span>
        </span>
        <span className="shrink-0 body-small tabular-nums">{formatQuantities(record.quantities)}</span>
      </div>
    );
  }
  return (
    <details className="group [border-top:var(--row-divider)] first:[border-top:none]">
      <summary className="flex cursor-pointer list-none flex-col gap-8 px-16 py-12 hover:bg-[var(--row-hover-bg-solid)] [&::-webkit-details-marker]:hidden">
        <span className="flex items-start justify-between gap-12">
          <RecordLabel record={record} />
          <span className="flex shrink-0 items-center gap-6 body-small tabular-nums">
            {formatQuantities(record.quantities)}
            <CaretDownIcon size={14} aria-hidden className={cn(FAINT, "transition-transform group-open:rotate-180")} />
          </span>
        </span>
        <Bar record={record} focus={focus} />
        <span className="flex flex-wrap gap-x-16 gap-y-4 body-caption">
          {shares.map((share) => {
            const focused = share.owner.key === focus.owner.key;
            return (
              <span key={share.owner.key} className={cn("inline-flex items-center gap-6", focused ? "font-medium text-[var(--ink)]" : MUTED)}>
                <Swatch owner={share.owner} owners={focus.owners} />
                {share.owner.label} {share.percent}%
              </span>
            );
          })}
        </span>
      </summary>
      <div className="px-16 pb-12">
        <table className="w-full border-collapse">
          <tbody>
            {shares.map((share) => (
              <tr key={share.owner.key} className="[border-top:var(--row-divider)] first:[border-top:none]">
                <th scope="row" className={cn("py-6 pr-12 text-left align-top body-small", share.owner.key === focus.owner.key ? "font-medium" : "font-normal")}>
                  {share.owner.label}
                  <span className={cn("block body-caption font-normal", MUTED)}>
                    {basisFor(record, share.owner).map((basis) => (basis.kg == null ? basis.label : `${basis.label} ${formatKg(basis.kg)}`)).join(", ")}
                  </span>
                </th>
                <td className="py-6 text-right align-top body-small tabular-nums">{share.percent}%</td>
                <td className="whitespace-nowrap py-6 pl-12 text-right align-top body-small tabular-nums">{formatQuantities(record.quantities, share.fraction)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function GroupBlock({ group, focus }: { group: GroupKey; focus: Focus }) {
  const records = recordsCarriedBy(focus.owner, group);
  if (records.length === 0) return null;
  const carried = totalsFor(focus.owner, group);
  return (
    <section className={cn(PANEL, "flex min-w-0 flex-col")}>
      <div className="flex flex-wrap items-center justify-between gap-x-16 gap-y-4 px-16 py-12 [border-bottom:var(--row-divider)]">
        <GroupTitle group={group} />
        <span className={cn("body-small tabular-nums", MUTED)}>
          {focus.owner.label} carries <span className="font-medium text-[var(--ink)]">{carried.map(formatQuantity).join(", ")}</span>
        </span>
      </div>
      {records.map((record) => <RecordRow key={record.id} record={record} focus={focus} />)}
    </section>
  );
}

export function VariantB({ focus }: { focus: Focus }) {
  return (
    <section aria-labelledby="allocation-b" className="flex min-w-0 flex-col gap-16">
      <span className="inline-flex items-center gap-6">
        <h2 id="allocation-b" className="title-heading-3">Allocation</h2>
        <ExplanationInfo
          title="Allocation"
          hint="Each bar is one whole record. The outlined part is what this page carries; the rest belongs to other credit batches or is still in the bin. Every bar adds up to 100%, so nothing is counted twice."
        />
      </span>
      {GROUPS.map((group) => <GroupBlock key={group.key} group={group.key} focus={focus} />)}
    </section>
  );
}
