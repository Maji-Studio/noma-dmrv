"use client";

/**
 * The records behind a waterfall column: one line each, the whole row a link
 * to the record, under a header that names the column and links to its list.
 */
import Link from "next/link";
import { ArrowRightIcon, CaretRightIcon } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui";
import { ExplanationInfo } from "@/components/ui/explanation-info";
import { formatMassKg } from "@/lib/format-utils";
import { RECORD_LINKS, recordHref } from "@/lib/record-links";
import { cn } from "@/lib/utils";
import { LINEAGE_NODE_STYLES, type LineageNodeKind } from "../chain-constants";
import type { WaterfallItem, WaterfallRecord } from "./waterfall-model";
import { ItemIcon, LIT_INK, MINUS, recordCountLabel } from "./waterfall-parts";

/** The list page behind a column ("All <plural>"), kept on the working facility. */
function listHref(kind: LineageNodeKind, facilityId: string | null): string {
  const { path } = RECORD_LINKS[kind];
  return facilityId ? `${path}?facility=${encodeURIComponent(facilityId)}` : path;
}

const MUTED = "text-[var(--color-text-tertiary)]";

export function RecordFigure({ item, record }: { item: WaterfallItem; record: WaterfallRecord }) {
  if (item.kind === "end") {
    // Wet and dry each labelled; the one that is missing says so.
    return (
      <>
        {formatMassKg(record.wetKg)} {record.wetKg == null ? "(wet)" : "wet"}
        <span className={MUTED}>
          {" · "}
          {formatMassKg(record.massKg)} {record.massKg == null ? "(dry)" : "dry"}
        </span>
      </>
    );
  }
  if (item.kind === "start") {
    return record.wetKg != null ? (
      <>
        {formatMassKg(record.wetKg)} <span className={MUTED}>wet</span>
      </>
    ) : (
      <span className={MUTED}>{formatMassKg(null)}</span>
    );
  }
  if (record.massKg == null) return <span className={MUTED}>{record.note ?? formatMassKg(null)}</span>;
  if (record.massKg < 0 && record.note) {
    return (
      <>
        <span className={MUTED}>{record.note} · </span>+{formatMassKg(-record.massKg)}
      </>
    );
  }
  return (
    <>
      {MINUS}
      {formatMassKg(record.massKg)}
    </>
  );
}

export function RecordRows({ item, facilityId, compact = false }: { item: WaterfallItem; facilityId: string | null; compact?: boolean }) {
  const style = LINEAGE_NODE_STYLES[item.recordKind];
  const KindIcon = style.icon;
  if (item.records.length === 0) {
    return <EmptyState icon={<KindIcon size={32} weight="thin" />} title="No records behind this column" padding="sm" />;
  }
  return (
    <ul className="flex flex-col" data-testid="sankey-records">
      {item.records.map((record) => (
        <li key={record.id} className="border-t border-[var(--clr-dark-purple-10)] first:border-t-0">
          <Link
            href={recordHref(record.kind, record.id, { facilityId })}
            className={cn(
              "body-small grid min-h-44 items-center gap-x-12 py-8 hover:bg-[var(--clr-dark-purple-1)]",
              compact ? "grid-cols-[auto_minmax(0,1fr)_auto_auto] px-12" : "grid-cols-[auto_minmax(0,auto)_minmax(0,1fr)_auto_auto] px-16",
            )}
            data-testid="sankey-record-row"
          >
            <span className="flex size-24 items-center justify-center" style={{ background: style.accent }} aria-hidden>
              <KindIcon size={14} className="text-[var(--paper)]" />
            </span>
            <span className="truncate font-medium text-[var(--color-text-primary)]">{record.code}</span>
            {compact ? null : <span className="truncate text-[var(--color-text-secondary)]">{record.name ?? ""}</span>}
            <span className="whitespace-nowrap text-right tabular-nums text-[var(--color-text-primary)]">
              <RecordFigure item={item} record={record} />
            </span>
            <CaretRightIcon size={14} className="text-[var(--color-text-tertiary)]" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** "All applications" and the arrow: the list page behind the column. */
export function ListLink({ item, facilityId }: { item: WaterfallItem; facilityId: string | null }) {
  return (
    // The margin sits on the wrapper: the type class on the link would beat it.
    <div className="ml-auto">
      <Link
        href={listHref(item.recordKind, facilityId)}
        className="body-small inline-flex min-h-44 items-center gap-6 font-medium text-[var(--clr-dark-purple)] underline-offset-4 hover:underline"
      >
        All {LINEAGE_NODE_STYLES[item.recordKind].plural}
        <ArrowRightIcon size={14} weight="bold" aria-hidden />
      </Link>
    </div>
  );
}

/** The record count and the list link: the first line of a phone detail. */
export function RecordsSummaryLine({ item, facilityId }: { item: WaterfallItem; facilityId: string | null }) {
  return (
    <div className="flex items-center gap-12 px-12">
      <span className="body-small text-[var(--color-text-tertiary)]">{recordCountLabel(item)}</span>
      <ExplanationInfo title={item.label} hint={item.note} />
      <ListLink item={item} facilityId={facilityId} />
    </div>
  );
}

export function RecordsPanel({ item, facilityId }: { item: WaterfallItem; facilityId: string | null }) {
  const lit = item.kind === "end";
  return (
    <section
      className="border-[1.5px] border-[var(--clr-dark-purple-40)] bg-[var(--paper)]"
      aria-label={`Records behind ${item.label}`}
      aria-live="polite"
    >
      <header className="flex flex-wrap items-center gap-x-16 gap-y-4 border-b border-[var(--clr-dark-purple-10)] bg-[var(--sea)] px-16 py-8">
        <span className="body-medium flex items-center gap-8 font-medium" style={{ color: lit ? LIT_INK : "var(--color-text-primary)" }}>
          <ItemIcon item={item} size={18} />
          {item.label}
          <ExplanationInfo title={item.label} hint={item.note} />
        </span>
        <span className="body-small text-[var(--color-text-tertiary)]">{recordCountLabel(item)}</span>
        <ListLink item={item} facilityId={facilityId} />
      </header>
      <div className="pt-8">
        <RecordRows item={item} facilityId={facilityId} />
      </div>
    </section>
  );
}
