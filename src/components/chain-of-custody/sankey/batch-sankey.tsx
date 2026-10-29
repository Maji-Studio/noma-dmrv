"use client";

/**
 * The batch mass balance (the Sankey view): a compact kg waterfall at the
 * top, a big figure and one sentence beside it, and under the chart the
 * records behind the selected column. The lit last column (applied) is the
 * default pick; every figure comes from the pure lib or the loaded lineages.
 * On a phone the chart becomes rows and the records open under the row.
 */
import { useSearchParams } from "next/navigation";
import { ChartBarIcon } from "@phosphor-icons/react/dist/ssr";
import { Button, EmptyState } from "@/components/ui";
import { SANKEY_EMPTY_DESCRIPTION, SANKEY_RUN_EMPTY_DESCRIPTION } from "@/lib/chain-of-custody/copy";
import type { CreditBatchSankeyData } from "@/lib/chain-of-custody/sankey";
import { RecordRows, RecordsPanel, RecordsSummaryLine } from "./records-panel";
import { WaterfallChart } from "./waterfall-chart";
import { buildWaterfall, DEFAULT_COLUMN, type WaterfallLineage } from "./waterfall-model";
import { HeadlineFigure, MassWarnings, ROWS_BELOW_PX, UnbalancedNotice, useColumnFocus, useMeasuredWidth } from "./waterfall-parts";
import { WaterfallRows } from "./waterfall-rows";

const PLOT_HEIGHT_PX = 168;

export interface BatchSankeyProps {
  sankey: CreditBatchSankeyData;
  lineages: readonly WaterfallLineage[];
  batchCode: string;
}

export function BatchSankey({ sankey, lineages, batchCode }: BatchSankeyProps) {
  const facilityId = useSearchParams().get("facility");
  const model = buildWaterfall(sankey, lineages);
  const focus = useColumnFocus(DEFAULT_COLUMN);
  const [width, measure] = useMeasuredWidth();
  const [chartWidth, measureChart] = useMeasuredWidth();
  const rows = width < ROWS_BELOW_PX;
  const selected = model.items.find((item) => item.key === focus.pinned) ?? model.items[model.items.length - 1];

  return (
    <div className="h-full overflow-auto bg-[var(--color-background-white)]" data-testid="batch-sankey" aria-label={`Mass balance for credit batch ${batchCode}`}>
      <div ref={measure} className="container-max flex flex-col gap-24 pb-96 pt-24">
        {model.balanced ? null : <UnbalancedNotice warnings={model.warnings} />}
        {rows ? (
          <>
            <HeadlineFigure model={model} />
            <WaterfallRows
              model={model}
              activeKey={focus.pinned}
              onSelect={focus.toggle}
              renderDetail={(item) => (
                <div className="border-[1.5px] border-[var(--clr-dark-purple-20)] bg-[var(--paper)]">
                  <RecordsSummaryLine item={item} facilityId={facilityId} />
                  <RecordRows item={item} facilityId={facilityId} compact />
                </div>
              )}
            />
          </>
        ) : (
          <>
            <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,9fr)] items-end gap-48">
              <div className="pb-72">
                <HeadlineFigure model={model} />
              </div>
              <div ref={measureChart} className="min-w-0">
                <WaterfallChart
                  model={model}
                  width={chartWidth}
                  plotHeight={PLOT_HEIGHT_PX}
                  // The lit column is the default pick; it dims nothing.
                  activeKey={focus.active === DEFAULT_COLUMN ? null : focus.active}
                  pinnedKey={focus.pinned}
                  onHover={focus.hover}
                  onSelect={focus.pin}
                />
              </div>
            </div>
            <RecordsPanel item={selected} facilityId={facilityId} />
          </>
        )}
        {model.balanced ? <MassWarnings warnings={model.warnings} /> : null}
      </div>
    </div>
  );
}

/** Nothing applied yet, or nothing from the filtered run: the EmptyState, never bare text. */
export function SankeyEmpty({ runFiltered, onOpenFlow }: { runFiltered: boolean; onOpenFlow: () => void }) {
  return (
    <div className="container-max flex h-full items-center justify-center py-24">
      <div className="w-full max-w-[640px]">
        <EmptyState
          icon={<ChartBarIcon size={48} weight="thin" />}
          title={runFiltered ? "Nothing applied from this run" : "Nothing applied yet"}
          description={runFiltered ? SANKEY_RUN_EMPTY_DESCRIPTION : SANKEY_EMPTY_DESCRIPTION}
          action={
            runFiltered ? undefined : (
              <Button variant="weak" onClick={onOpenFlow}>
                Open Flow
              </Button>
            )
          }
        />
      </div>
    </div>
  );
}
