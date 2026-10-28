"use client";

/**
 * PROTOTYPE variant B, "Waterfall + records" (?variant=b). The same waterfall,
 * compact at the top, is the index of the batch: selecting a column lists the
 * records behind it below the chart, one line each, the whole row a link to
 * the record. The lit last column is selected by default.
 */
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRightIcon, CaretRightIcon } from "@phosphor-icons/react/dist/ssr";
import { formatMassKg } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import { LINEAGE_NODE_STYLES } from "../../chain-constants";
import { recordHref, recordListHref } from "./record-href";
import type { SankeyVariantProps } from "./variant-a-mass-waterfall";
import { WaterfallChart } from "./waterfall-chart";
import { buildWaterfall, type WaterfallItem, type WaterfallRecord } from "./waterfall-model";
import { WaterfallRows } from "./waterfall-rows";
import {
  HeadlineFigure,
  ItemIcon,
  LIT_INK,
  MassWarnings,
  MINUS,
  recordCountLabel,
  ROWS_BELOW_PX,
  signedKg,
  useColumnFocus,
  useMeasuredWidth,
} from "./waterfall-shared";

const PLOT_HEIGHT_PX = 168;

function RecordFigure({ item, record }: { item: WaterfallItem; record: WaterfallRecord }) {
  if (record.massKg == null && record.wetKg == null) {
    return <span className="text-[var(--color-text-tertiary)]">Not recorded</span>;
  }
  if (item.kind === "end") {
    return (
      <>
        {record.wetKg != null ? formatMassKg(record.wetKg) : null}
        {record.massKg != null ? (
          <span className="text-[var(--color-text-tertiary)]">
            {record.wetKg != null ? " · " : ""}
            {formatMassKg(record.massKg)} dry
          </span>
        ) : null}
      </>
    );
  }
  const sign = item.kind === "step" ? MINUS : "";
  return (
    <>
      {sign}
      {formatMassKg(record.massKg)}
      {item.kind === "start" ? <span className="text-[var(--color-text-tertiary)]"> {item.basis}</span> : null}
    </>
  );
}

function RecordRows({ item, facilityId, compact = false }: { item: WaterfallItem; facilityId: string | null; compact?: boolean }) {
  const style = LINEAGE_NODE_STYLES[item.recordKind];
  const KindIcon = style.icon;
  if (item.records.length === 0) {
    return <p className="body-small px-16 py-12 text-[var(--color-text-secondary)]">No records behind this column.</p>;
  }
  return (
    <ul className="flex flex-col" data-testid="sankey-records">
      {item.records.map((record) => (
        <li key={record.id} className="border-t border-[var(--clr-dark-purple-10)] first:border-t-0">
          <Link
            href={recordHref(record.kind, record.id, facilityId)}
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

function RecordsPanel({ item, facilityId }: { item: WaterfallItem; facilityId: string | null }) {
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
        </span>
        <span className="body-small tabular-nums text-[var(--color-text-secondary)]">{signedKg(item)} kg</span>
        <span className="body-small text-[var(--color-text-tertiary)]">{recordCountLabel(item)}</span>
        <Link
          href={recordListHref(item.recordKind, facilityId)}
          className="body-small ml-auto inline-flex min-h-44 items-center gap-6 font-medium text-[var(--clr-dark-purple)] underline-offset-4 hover:underline"
        >
          See details
          <ArrowRightIcon size={14} weight="bold" aria-hidden />
        </Link>
      </header>
      <p className="body-small px-16 pt-12 text-[var(--color-text-secondary)]">{item.note}</p>
      <div className="pt-8">
        <RecordRows item={item} facilityId={facilityId} />
      </div>
    </section>
  );
}

export function VariantBWaterfallRecords({ sankey, lineages, batchCode }: SankeyVariantProps) {
  const facilityId = useSearchParams().get("facility");
  const model = buildWaterfall(sankey, lineages);
  const focus = useColumnFocus("applied");
  const [width, measure] = useMeasuredWidth();
  const [chartWidth, measureChart] = useMeasuredWidth();
  const rows = width < ROWS_BELOW_PX;
  const selected = model.items.find((item) => item.key === focus.pinned) ?? model.items[model.items.length - 1];

  return (
    <div className="h-full overflow-auto bg-[var(--color-background-white)]" data-testid="batch-sankey" aria-label={`Mass balance for credit batch ${batchCode}`}>
      <div ref={measure} className="container-max flex flex-col gap-24 pb-96 pt-24">
        {rows ? (
          <>
            <HeadlineFigure model={model} compact />
            <WaterfallRows
              model={model}
              activeKey={focus.pinned}
              onSelect={focus.toggle}
              renderDetail={(item) => (
                <div className="border-[1.5px] border-[var(--clr-dark-purple-20)] bg-[var(--paper)]">
                  <RecordRows item={item} facilityId={facilityId} compact />
                </div>
              )}
            />
          </>
        ) : (
          <>
            <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,9fr)] items-end gap-48">
              <div className="pb-72">
                <HeadlineFigure model={model} compact />
              </div>
              <div ref={measureChart} className="min-w-0">
                <WaterfallChart
                  model={model}
                  width={chartWidth}
                  plotHeight={PLOT_HEIGHT_PX}
                  // The lit column is the default pick; it dims nothing.
                  activeKey={focus.active === "applied" ? null : focus.active}
                  pinnedKey={focus.pinned}
                  onHover={focus.hover}
                  onSelect={focus.pin}
                />
              </div>
            </div>
            <RecordsPanel item={selected} facilityId={facilityId} />
          </>
        )}
        <MassWarnings warnings={model.warnings} />
      </div>
    </div>
  );
}
