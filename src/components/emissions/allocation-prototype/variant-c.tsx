/**
 * PROTOTYPE variant C, "This batch carries": written from the page's own
 * point of view. A strip of what it carries per line, then one sentence-like
 * row per record ("80% of FS-26-001", "672 of 840 t·km"). A shared record
 * opens to where the rest went and, for feedstock, today's rule next to this one.
 */
"use client";

import { ArrowRightIcon, CaretDownIcon } from "@phosphor-icons/react/dist/ssr";
import { ExplanationInfo } from "@/components/ui/explanation-info";
import { cn } from "@/lib/utils";
import {
  GROUPS,
  basisFor,
  formatDay,
  formatKg,
  formatQuantities,
  formatValue,
  recordsCarriedBy,
  sharesOf,
  totalsFor,
  type Focus,
  type GroupKey,
  type Owner,
  type SourceRecord,
} from "./fixture";
import { FAINT, GroupTitle, MUTED, PANEL, Swatch, focusNoun } from "./parts";

function amountOf(record: SourceRecord, fraction: number): string {
  if (fraction >= 1) return formatQuantities(record.quantities);
  return record.quantities.map((quantity) => `${formatValue(quantity.value * fraction, quantity.unit).replace(` ${quantity.unit}`, "")} of ${formatValue(quantity.value, quantity.unit)}`).join(", ");
}

function SharesBlock({ title, shares, focus }: { title: string; shares: { owner: Owner; percent: number }[]; focus: Focus }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 border border-[var(--color-border-tertiary)] px-12 py-8">
      <span className={cn("body-caption", MUTED)}>{title}</span>
      {shares.map((share) => (
        <span key={share.owner.key} className={cn("inline-flex items-center gap-6 body-small tabular-nums", share.owner.key === focus.owner.key && "font-medium")}>
          <Swatch owner={share.owner} owners={focus.owners} />
          {share.owner.label} {share.percent}%
        </span>
      ))}
    </div>
  );
}

function TodayVersusRule({ record, focus }: { record: SourceRecord; focus: Focus }) {
  const todayOwner = focus.owners.find((owner) => record.todayOwner && owner.batches.includes(record.todayOwner));
  if (!todayOwner) return null;
  const shares = sharesOf(record, focus.owners);
  return (
    <div className="flex flex-col gap-6">
      <span className={cn("body-caption", MUTED)}>Transport of this delivery</span>
      <div className="flex items-stretch gap-8">
        <SharesBlock title="Today (first run takes all)" shares={[{ owner: todayOwner, percent: 100 }]} focus={focus} />
        <ArrowRightIcon size={16} aria-hidden className={cn("shrink-0 self-center", FAINT)} />
        <SharesBlock title="With this rule" shares={shares} focus={focus} />
      </div>
    </div>
  );
}

function RecordRow({ record, focus }: { record: SourceRecord; focus: Focus }) {
  const shares = sharesOf(record, focus.owners);
  const mine = shares.find((share) => share.owner.key === focus.owner.key);
  if (!mine) return null;
  const others = shares.filter((share) => share.owner.key !== focus.owner.key);
  const head = (
    <span className="flex items-start justify-between gap-12">
      <span className="flex min-w-0 flex-col">
        <span className="body-small">
          <span className="font-medium tabular-nums">{mine.percent === 100 ? "All" : `${mine.percent}%`}</span> of{" "}
          <span className="font-medium underline-offset-2 hover:underline">{record.code}</span>
        </span>
        <span className={cn("truncate body-caption", MUTED)}>{formatDay(record.date)}, {record.detail}</span>
      </span>
      <span className="flex shrink-0 items-center gap-6 text-right body-small tabular-nums">
        {amountOf(record, mine.fraction)}
        {others.length > 0 && <CaretDownIcon size={14} aria-hidden className={cn(FAINT, "transition-transform group-open:rotate-180")} />}
      </span>
    </span>
  );
  if (others.length === 0) {
    return <li className="px-16 py-10 [border-top:var(--row-divider)] first:[border-top:none]">{head}</li>;
  }
  return (
    <li className="[border-top:var(--row-divider)] first:[border-top:none]">
      <details className="group">
        <summary className="cursor-pointer list-none px-16 py-10 hover:bg-[var(--row-hover-bg-solid)] [&::-webkit-details-marker]:hidden">{head}</summary>
        <div className="flex flex-col gap-12 px-16 pb-12 pl-32">
          <div className="flex flex-col gap-4">
            <span className={cn("body-caption", MUTED)}>Where the rest went</span>
            {others.map((share) => (
              <span key={share.owner.key} className="flex items-start justify-between gap-12 body-small">
                <span className="inline-flex min-w-0 items-start gap-6">
                  <Swatch owner={share.owner} owners={focus.owners} className="mt-4" />
                  <span className="flex min-w-0 flex-col">
                    <span>{share.owner.label}</span>
                    <span className={cn("body-caption", MUTED)}>
                      {basisFor(record, share.owner).map((basis) => (basis.kg == null ? basis.label : `${basis.label} ${formatKg(basis.kg)}`)).join(", ")}
                    </span>
                  </span>
                </span>
                <span className="shrink-0 text-right tabular-nums">
                  {share.percent}%, {formatQuantities(record.quantities, share.fraction)}
                </span>
              </span>
            ))}
          </div>
          {record.group === "feedstockTransport" && <TodayVersusRule record={record} focus={focus} />}
        </div>
      </details>
    </li>
  );
}

function SummaryStrip({ focus }: { focus: Focus }) {
  return (
    <dl className="grid grid-cols-2 bg-[var(--paper)] [border:var(--panel-border)] lg:grid-cols-4">
      {GROUPS.map((group, index) => {
        const totals = totalsFor(focus.owner, group.key);
        const count = recordsCarriedBy(focus.owner, group.key).length;
        return (
          <div
            key={group.key}
            className={cn(
              "flex min-w-0 flex-col gap-2 px-16 py-10",
              index % 2 === 0 && "[border-right:var(--row-divider)]",
              index < 2 && "[border-bottom:var(--row-divider)] lg:[border-bottom:none]",
              index === 1 && "lg:[border-right:var(--row-divider)]",
            )}
          >
            <dt className={cn("body-caption", MUTED)}>{group.title}</dt>
            <dd className="flex flex-col">
              {totals.length ? (
                totals.map((quantity) => <span key={quantity.unit} className="body-large font-medium tabular-nums">{formatValue(quantity.value, quantity.unit)}</span>)
              ) : (
                <span className={cn("body-small", MUTED)}>None</span>
              )}
              <span className={cn("body-caption", FAINT)}>{count === 1 ? "1 record" : `${count} records`}</span>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function GroupList({ group, focus }: { group: GroupKey; focus: Focus }) {
  const records = recordsCarriedBy(focus.owner, group);
  if (records.length === 0) return null;
  return (
    <section className={cn(PANEL, "flex min-w-0 flex-col")}>
      <div className="px-16 py-12 [border-bottom:var(--row-divider)]">
        <GroupTitle group={group} />
      </div>
      <ul className="flex flex-col">
        {records.map((record) => <RecordRow key={record.id} record={record} focus={focus} />)}
      </ul>
    </section>
  );
}

export function VariantC({ focus }: { focus: Focus }) {
  const title = `${focusNoun(focus)} carries`;
  return (
    <section aria-labelledby="allocation-c" className="flex min-w-0 flex-col gap-16">
      <span className="inline-flex items-center gap-6">
        <h2 id="allocation-c" className="title-heading-3">{title}</h2>
        <ExplanationInfo
          title={title}
          hint="Its part of every record that causes emissions. A shared record opens to where the rest went, so each one adds up to 100% across credit batches and nothing is counted twice."
        />
      </span>
      <SummaryStrip focus={focus} />
      {GROUPS.map((group) => <GroupList key={group.key} group={group.key} focus={focus} />)}
    </section>
  );
}
