/**
 * The two cards every bin's detail sheet shows, feedstock and output alike.
 * The stock card: the headline wet figure, the figures under it and the
 * stock drawn as bays, with its one action, Adjust stock, in its header. The
 * chart card under it: the level over time, with History under the chart.
 */
"use client";

import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/ssr";
import { TextAction } from "@/components/forms/text-action";
import { EmptyState } from "@/components/ui";
import type { ReactNode } from "react";
import { InfoHint } from "@/components/ui/tooltip";
import { STOCK_ACTION_LABEL } from "@/lib/output-stock/labels";

const ACTION_ICON_PX = 16;
const CHART_TITLE = "Stock over time";
const CHART_HINT = "The bin's level after each entry. Water is estimated from the stock records. Hover, focus or tap a step for details.";
const CHART_EMPTY = "Recorded movements will appear here.";

/** A card's one action: a text button at the right of its header. */
export function CardTextButton({ icon, children, onClick }: { icon: ReactNode; children: ReactNode; onClick: () => void }) {
  return (
    <TextAction onClick={onClick} className="-mr-6">
      {icon}{children}
    </TextAction>
  );
}

/** A card's title with its ⓘ beside it, and an optional action on the right. */
function CardHeader({ title, hint, hintLabel, action }: { title: string; hint: string; hintLabel: string; action?: ReactNode }) {
  return (
    <div className="flex min-h-44 items-center justify-between gap-8">
      <span className="flex min-w-0 items-center gap-6">
        <span className="truncate body-small font-medium">{title}</span>
        <InfoHint label={hintLabel}>{hint}</InfoHint>
      </span>
      {action}
    </div>
  );
}

export function StockCard({ title, hint, figure, caption, status, children, onAdjust }: {
  title: string;
  hint: string;
  /** The headline: the bin's wet stock. */
  figure?: ReactNode;
  caption?: ReactNode;
  /** Loading and error lines, in the figure's place. */
  status?: ReactNode;
  /** The stock drawn as bays. */
  children?: ReactNode;
  onAdjust?: () => void;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-12 bg-[var(--panel-bg)] [border:var(--panel-border)] px-12 pt-6 pb-12">
      <div className="flex flex-col gap-2">
        <CardHeader title={title} hint={hint} hintLabel="About this stock" action={onAdjust &&
          <CardTextButton icon={<ArrowsClockwiseIcon size={ACTION_ICON_PX} aria-hidden="true" />} onClick={onAdjust}>{STOCK_ACTION_LABEL}</CardTextButton>
        } />
        {status}
        {figure && <p className="body-large font-medium tabular-nums">{figure}</p>}
        {caption && <p className="body-caption text-[var(--color-text-secondary)] tabular-nums">{caption}</p>}
      </div>
      {children}
    </section>
  );
}

/** The bin's level over time, with a quiet history text button below the chart. */
export function StockChartCard({ children, history }: {
  /** The chart, or its loading/error state. */
  children?: ReactNode;
  /** The history opener, drawn as a `CardTextButton` by the caller. */
  history: ReactNode;
}) {
  return (
    <section aria-label={CHART_TITLE} className="flex flex-col gap-12 bg-[var(--panel-bg)] [border:var(--panel-border)] px-12 pt-6 pb-12">
      <CardHeader title={CHART_TITLE} hint={CHART_HINT} hintLabel="About this chart" />
      {children ?? <EmptyState icon={null} title="No stock history" description={CHART_EMPTY} padding="sm" />}
      <div className="flex justify-end">{history}</div>
    </section>
  );
}
